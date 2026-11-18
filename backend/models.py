import asyncio
import time
import uuid
import base64
import json
import re
from types import SimpleNamespace
from urllib.parse import urlsplit, urlunsplit
from openai import AsyncOpenAI, APIStatusError, APIConnectionError, APITimeoutError
from .usage import UsageLedger, reported_usage

def json_result(text):
    try:
        return json.loads(re.sub(r'^```(?:json)?\s*|\s*```$', '', text.strip()))
    except (ValueError, TypeError):
        raise ValueError('模型未返回有效 JSON，请重试') from None

def validate_rank(value, ids):
    if not isinstance(value, dict) or not isinstance(value.get('matches'), list):
        raise ValueError('模型排序格式无效')
    allowed, seen, rows = set(ids), set(), []
    for row in value['matches']:
        if isinstance(row, dict) and isinstance(row.get('id'),str) and row['id'] in allowed and row['id'] not in seen:
            seen.add(row['id'])
            rows.append({'id': row['id'], 'reason': str(row.get('reason', ''))[:200]})
    return rows

class ModelService:
    def __init__(self, settings):
        self.settings = settings
        self.ledger = UsageLedger(settings.model_usage_log)

    async def run(self, request, phase):
        image_task = request.kind in ('generate', 'edit')
        row = {'id': uuid.uuid4().hex, 'model': self.settings.image_model_name if image_task else self.settings.model_name,
               'kind': request.kind, 'status': 'failed', 'inputTokens': None, 'outputTokens': None,
               'inputImages': len(request.images), 'outputImages': 0, 'startedAt': time.time()}
        try:
            result = await self._execute(request, phase, row)
            row['status'] = 'succeeded'
            result['usage'] = row
            return result
        except asyncio.CancelledError:
            row['status'] = 'cancelled'
            raise
        except Exception as error:
            message = str(error) if isinstance(error, ValueError) else '模型服务响应异常，请稍后重试'
            raise self.failure(message, row) from None
        finally:
            row['finishedAt'] = time.time()
            row['recorded'] = await self.ledger.record(row)

    @staticmethod
    def failure(message, usage):
        error = ValueError(message)
        error.model_usage = usage
        return error

    async def _execute(self, request, phase, metrics):
        cfg = self.settings
        kind, images, query = request.kind, request.images, request.query
        image_task = kind in ('generate', 'edit')
        if not (cfg.image_model_ready if image_task else cfg.model_ready):
            raise ValueError('图片生成服务尚未配置，请联系管理员' if image_task else '模型服务尚未配置，请联系管理员')
        if image_task and len(images) > 3:
            raise ValueError('图片生成或编辑最多支持3张参考图')
        if kind == 'edit' and not images:
            raise ValueError('图片编辑需要参考图')
        model_name = cfg.image_model_name if image_task else cfg.model_name
        client = AsyncOpenAI(base_url=cfg.model_base_url, api_key=cfg.model_api_key.get_secret_value(), timeout=600 if image_task else 180, max_retries=0)
        phase('正在请求模型服务')
        try:
            if image_task:
                # Bailian uses JSON /images/generations for both T2I and I2I.
                # References are extension fields, not multipart /images/edits uploads.
                extra = {'image': images[0] if len(images) == 1 else images} if images else {}
                prompt = '依据参考图创作新的装饰纹理设计。'+query if kind == 'generate' and images else query
                if cfg.image_api_protocol == 'dashscope':
                    # The legacy Beijing host exposes image generation through DashScope.
                    # Keep the same account, key and model; only the wire protocol differs.
                    parts = urlsplit(cfg.model_base_url)
                    endpoint = urlunsplit((parts.scheme, parts.netloc, '/api/v1/services/aigc/multimodal-generation/generation', '', ''))
                    body = {'model': model_name, 'input': {'messages': [{'role': 'user', 'content': [{'image': image} for image in images] + [{'text': prompt}]}]}, 'parameters': {'n': 1}}
                    phase('正在生成图片')
                    response = await client.post(endpoint, cast_to=dict, body=body)
                    metrics.update(reported_usage(response.get('usage')))
                    if response.get('code'):
                        raise ValueError('图片服务未完成生成，请检查模型权限及额度')
                    choices = response.get('output', {}).get('choices', [])
                    urls = [part['image'] for choice in choices for part in choice.get('message', {}).get('content', []) if isinstance(part, dict) and isinstance(part.get('image'), str)]
                    result = SimpleNamespace(data=[SimpleNamespace(url=url, b64_json=None) for url in urls])
                else:
                    result = await client.images.generate(model=model_name, prompt=prompt, n=1, **({'extra_body': extra} if extra else {}))
                if cfg.image_api_protocol != 'dashscope': metrics.update(reported_usage(getattr(result, 'usage', None)))
                output = []
                for image in (result.data or [])[:1]:
                    if image.b64_json:
                        if len(image.b64_json) > 40 * 1024 * 1024:
                            raise ValueError('生成图片超过大小限制')
                        base64.b64decode(image.b64_json, validate=True)
                        output.append('data:image/png;base64,'+image.b64_json)
                    elif image.url:
                        phase('正在读取生成图片')
                        output.append(await download_image(image.url))
                if not output:
                    raise ValueError('当前模型服务未返回图片，请确认支持图片生成／编辑接口')
                metrics['outputImages'] = len(output)
                return {'images': output, 'model': model_name}
            instructions = {
                'terms': '将描述转换为纹理图库检索词。将材质、色系、纹理方向拆成短词并附常用英文同义词，不增加未提供的条件。只返回 JSON {"terms":["词"]}，最多12个词。',
                'rank': '比较候选纹理，整体形态、疏密、走向优先；文字明确要求时才考虑颜色。参考图存在时为第一张，随后图片按候选顺序排列。仅返回符合要求的已提供编号，允许空列表。只返回 JSON {"matches":[{"id":"编号","reason":"原因"}]}。',
                'probe': '简要描述参考图；没有图片时回答连接正常。',
            }
            has_reference = request.has_reference if request.has_reference is not None else len(images) == len(request.candidates) + 1
            if kind == 'rank':
                instructions['rank'] = ('比较纹理整体形态、疏密、走向；仅在文字明确要求时考虑颜色。' +
                    ('必须把全部候选编号各返回一次，仅排序，不得删除候选。差异较大也按相对接近程度排序。' if request.rank_policy == 'all' else '按文字条件筛选并排序，允许空列表，不用无关候选补足。') +
                    ('第一张为参考来样。' if has_reference else '没有参考来样，每张图片都是独立候选。') +
                    '只返回JSON {"matches":[{"id":"编号","reason":"简短原因"}]}，不得编造编号。')
            payload = json.dumps({'query': query, 'candidates': request.candidates, 'has_reference': has_reference}, ensure_ascii=False)
            content = [{'type':'text','text':payload}]+[{'type':'image_url','image_url':{'url':image}} for image in images]
            if kind == 'rank':
                content = [{'type':'text','text':payload}]
                if has_reference: content += [{'type':'text','text':'参考来样'}, {'type':'image_url','image_url':{'url':images[0]}}]
                for candidate, image in zip(request.candidates, images[int(has_reference):]):
                    content += [{'type':'text','text':'候选编号：'+candidate['id']}, {'type':'image_url','image_url':{'url':image}}]
            thinking = ({'thinking_budget':min(cfg.model_thinking_budget,cfg.model_max_output_tokens//2)} if cfg.model_thinking_budget else {'enable_thinking':False}) if cfg.model_name.lower().startswith('qwen') else {}
            result = await client.chat.completions.create(model=cfg.model_name, messages=[{'role':'system','content':instructions[kind]}, {'role':'user','content':content}], max_completion_tokens=cfg.model_max_output_tokens, **({'extra_body':thinking} if thinking else {}), **({'response_format':{'type':'json_object'}} if kind in ('rank','terms') else {}))
            metrics.update(reported_usage(getattr(result, 'usage', None)))
            if getattr(result.choices[0], 'finish_reason', None) == 'length': raise ValueError('模型输出达到本次长度预算，未完成结果解析，请调整预算或缩小候选数量')
            text = result.choices[0].message.content or ''
            if kind == 'rank':
                ids = [r['id'] for r in request.candidates]
                rows = validate_rank(json_result(text), ids)
                omitted = len(ids) - len(rows)
                if request.rank_policy == 'all':
                    seen = {r['id'] for r in rows}
                    rows += [{'id': ident, 'reason': '沿用结构初筛顺序'} for ident in ids if ident not in seen]
                return {'matches':rows, 'model':cfg.model_name, 'omittedCount':omitted}
            if kind == 'terms':
                data = json_result(text)
                if not isinstance(data,dict) or not isinstance(data.get('terms'),list):
                    raise ValueError('模型检索条件格式无效')
                return {'terms':list(dict.fromkeys(t.strip() for t in data['terms'] if isinstance(t,str) and 0<len(t.strip())<100))[:12]}
            return {'text':text, 'model':cfg.model_name}
        except APIStatusError as error:
            messages = {401:'模型密钥无效',403:'模型接口未获授权',402:'模型账户额度不足',429:'模型服务限流或额度不足',404:'模型名称或接口不存在'}
            raise ValueError(messages.get(error.status_code, '模型服务请求失败，请检查接口兼容性（HTTP '+str(error.status_code)+'）')) from None
        except (APIConnectionError, APITimeoutError):
            raise ValueError('模型服务连接失败或请求超时') from None
        finally:
            await client.close()

async def download_image(url):
    # Only public HTTPS image downloads, no redirects or backend credentials.
    import socket, ipaddress
    from urllib.parse import urlparse
    import httpx
    from asyncio import to_thread
    u = urlparse(url)
    if u.scheme != 'https' or not u.hostname or u.username or u.password or u.port not in (None,443):
        raise ValueError('模型图片下载地址无效')
    records = await to_thread(socket.getaddrinfo, u.hostname, 443)
    if any(not ipaddress.ip_address(r[4][0]).is_global for r in records):
        raise ValueError('模型图片地址不能指向内网')
    async with httpx.AsyncClient(timeout=60, follow_redirects=False) as client:
        async with client.stream('GET',url) as response:
            response.raise_for_status()
            mime=response.headers.get('content-type','').split(';')[0]
            if mime not in ('image/png','image/jpeg','image/webp'):
                raise ValueError('模型未返回有效图片')
            data=bytearray()
            async for chunk in response.aiter_bytes():
                data.extend(chunk)
                if len(data)>30*1024*1024: raise ValueError('生成图片超过大小限制')
    return 'data:'+mime+';base64,'+base64.b64encode(data).decode()

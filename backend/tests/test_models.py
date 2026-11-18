"""Exercise the real OpenAI SDK against an in-memory HTTP transport, never a paid API."""
import asyncio
import json

import httpx
import pytest
from fastapi.testclient import TestClient
from openai import AsyncOpenAI

from backend.config import Settings
from backend.main import ModelRequest, create_app
from backend.models import ModelService


IMAGE = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg=='


def configured(**kwargs):
    return Settings(_env_file=None, model_usage_log=None, model_api_key='test-only-bailian-key', **{'image_api_protocol':'openai', **kwargs})


def test_bailian_wire_protocol_and_shared_credentials(monkeypatch):
    requests, clients, downloads = [], [], []

    def respond(request):
        body = json.loads(request.content)
        requests.append((request, body))
        if request.url.path.endswith('/chat/completions'):
            payload = json.loads(body['messages'][1]['content'][0]['text'])
            if payload['candidates']:
                content = '{"matches":[{"id":"unknown"},{"id":"sample-a","reason":"纹理走向相同"},{"id":"sample-a"}]}'
            elif 'response_format' in body:
                content = '{"terms":["wood","wood","浅色"]}'
            else:
                content = '连接正常'
            return httpx.Response(200, json={'choices': [{'message': {'role': 'assistant', 'content': content}}]})
        assert request.url.path.endswith('/images/generations')
        return httpx.Response(200, json={'created': 1, 'data': [{'url': 'https://images.example.test/result.png'}]})

    def client_factory(**kwargs):
        transport = httpx.AsyncClient(transport=httpx.MockTransport(respond))
        clients.append((kwargs, transport))
        return AsyncOpenAI(**kwargs, http_client=transport)

    async def download(url):
        downloads.append(url)
        return IMAGE

    monkeypatch.setattr('backend.models.AsyncOpenAI', client_factory)
    monkeypatch.setattr('backend.models.download_image', download)

    async def run():
        service = ModelService(configured())
        terms=await service.run(ModelRequest(kind='terms', query='浅色木纹'), lambda _: None)
        assert terms['terms']==['wood','浅色'] and terms['usage']['status']=='succeeded'
        ranked = await service.run(ModelRequest(kind='rank', images=[IMAGE, IMAGE], candidates=[{'id': 'sample-a'}]), lambda _: None)
        assert ranked['matches'] == [{'id': 'sample-a', 'reason': '纹理走向相同'}] and ranked['model']=='qwen4-max'
        assert (await service.run(ModelRequest(kind='probe', images=[IMAGE]), lambda _: None))['model'] == 'qwen4-max'
        for kind, references in [('generate', []), ('generate', [IMAGE]), ('edit', [IMAGE]), ('edit', [IMAGE] * 3)]:
            result = await service.run(ModelRequest(kind=kind, query='浅色橡木', images=references), lambda _: None)
            assert result['images']==[IMAGE] and result['model']=='qwen-image-3.0-pro' and result['usage']['outputImages']==1

    asyncio.run(run())
    assert len(requests) == 7
    for request, body in requests:
        assert request.url.host == 'dashscope.aliyuncs.com'
        assert request.headers['authorization'] == 'Bearer test-only-bailian-key'
        assert request.headers['content-type'] == 'application/json'
        assert request.method == 'POST'
    for request, body in requests[:3]:
        assert body['model'] == 'qwen4-max'
        assert request.url.path == '/compatible-mode/v1/chat/completions'
    assert requests[0][1]['response_format'] == requests[1][1]['response_format'] == {'type': 'json_object'}
    assert [c for c in requests[1][1]['messages'][1]['content'] if c['type']=='image_url'] == [{'type': 'image_url', 'image_url': {'url': IMAGE}}] * 2
    assert requests[1][1]['max_completion_tokens']==4096 and requests[1][1]['thinking_budget']==1024
    assert 'image' not in requests[3][1]
    assert requests[4][1]['image'] == requests[5][1]['image'] == IMAGE
    assert requests[4][1]['prompt'].startswith('依据参考图')
    assert requests[5][1]['prompt'] == '浅色橡木'
    assert requests[6][1]['image'] == [IMAGE] * 3
    for request, body in requests[3:]:
        assert body['model'] == 'qwen-image-3.0-pro' and body['n'] == 1
        assert 'response_format' not in body
    assert len(downloads) == 4
    assert [kwargs['timeout'] for kwargs, _ in clients] == [180] * 3 + [600] * 4
    assert all(transport.is_closed for _, transport in clients)


@pytest.mark.parametrize('kind,images,message', [('edit', [], '需要参考图'), ('generate', [IMAGE] * 4, '最多支持3张')])
def test_invalid_image_requests_do_not_contact_provider(monkeypatch, kind, images, message):
    def unexpected_client(**kwargs):
        pytest.fail('invalid request reached the provider')
    monkeypatch.setattr('backend.models.AsyncOpenAI', unexpected_client)
    with pytest.raises(ValueError, match=message):
        asyncio.run(ModelService(configured()).run(ModelRequest(kind=kind, images=images), lambda _: None))


def test_model_configuration_and_status_do_not_expose_keys():
    cfg = configured(tikhub_api_key='test-only-tikhub-key')
    assert cfg.model_ready and cfg.image_model_ready
    with TestClient(create_app(cfg)) as client:
        assert client.get('/api/health').json()['imageModelConfigured'] is True
        response = client.get('/api/model/status')
        assert response.json()['model'] == 'qwen4-max'
        assert response.json()['imageModel'] == 'qwen-image-3.0-pro'
        assert 'test-only' not in response.text
    service = ModelService(configured(image_model_name=''))
    with pytest.raises(ValueError, match='尚未配置'):
        asyncio.run(service.run(ModelRequest(kind='generate'), lambda _: None))
    assert service.settings.model_ready


def test_native_dashscope_image_protocol(monkeypatch):
    calls=[]
    def respond(request):
        assert request.url.path == '/api/v1/services/aigc/multimodal-generation/generation'
        assert request.headers['authorization'] == 'Bearer test-only-bailian-key'
        calls.append(json.loads(request.content))
        return httpx.Response(200,json={'output':{'choices':[{'message':{'content':[{'image':'https://images.example.test/result.png'}]}}]}})
    def factory(**kwargs):
        return AsyncOpenAI(**kwargs,http_client=httpx.AsyncClient(transport=httpx.MockTransport(respond)))
    async def download(url): return IMAGE
    monkeypatch.setattr('backend.models.AsyncOpenAI',factory)
    monkeypatch.setattr('backend.models.download_image',download)
    async def run():
        service=ModelService(configured(image_api_protocol='dashscope'))
        for kind,images in [('generate',[]),('edit',[IMAGE]),('generate',[IMAGE]*3)]:
            result=await service.run(ModelRequest(kind=kind,query='wood',images=images),lambda _:None)
            assert result['images']==[IMAGE] and result['model']=='qwen-image-3.0-pro' and result['usage']['outputImages']==1
    asyncio.run(run())
    for body in calls:
        assert body['model']=='qwen-image-3.0-pro' and body['parameters']=={'n':1}
        assert body['input']['messages'][0]['role']=='user'
        assert 'text' in body['input']['messages'][0]['content'][-1]
    assert len(calls[0]['input']['messages'][0]['content'])==1
    assert calls[1]['input']['messages'][0]['content'][0]=={'image':IMAGE}
    assert len(calls[2]['input']['messages'][0]['content'])==4


@pytest.mark.parametrize('status,message', [(401, '密钥无效'), (403, '未获授权'), (404, '名称或接口不存在'), (429, '限流或额度不足')])
def test_bailian_errors_close_client_and_hide_upstream_body(monkeypatch, status, message):
    transports = []
    def client_factory(**kwargs):
        transport = httpx.AsyncClient(transport=httpx.MockTransport(lambda _: httpx.Response(status, json={'error': {'message': 'sensitive-provider-response'}})))
        transports.append(transport)
        return AsyncOpenAI(**kwargs, http_client=transport)
    monkeypatch.setattr('backend.models.AsyncOpenAI', client_factory)
    with pytest.raises(ValueError, match=message) as error:
        asyncio.run(ModelService(configured()).run(ModelRequest(kind='generate'), lambda _: None))
    assert 'sensitive-provider-response' not in str(error.value)
    assert all(transport.is_closed for transport in transports)


def test_empty_image_result_is_failure(monkeypatch):
    def client_factory(**kwargs):
        return AsyncOpenAI(**kwargs, http_client=httpx.AsyncClient(transport=httpx.MockTransport(lambda _: httpx.Response(200, json={'created': 1, 'data': []})) ))
    monkeypatch.setattr('backend.models.AsyncOpenAI', client_factory)
    with pytest.raises(ValueError, match='未返回图片'):
        asyncio.run(ModelService(configured()).run(ModelRequest(kind='generate'), lambda _: None))

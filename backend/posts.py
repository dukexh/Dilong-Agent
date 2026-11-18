import asyncio
import time
import uuid
from datetime import datetime, timezone
from urllib.parse import urlparse
import httpx

def safe_url(value):
    if not isinstance(value,str): return ''
    u=urlparse(value)
    return value if u.scheme=='https' and u.hostname and not u.username else ''

def first_image(value):
    if isinstance(value,str): return safe_url(value)
    if isinstance(value,list): return next((v for x in value if (v:=first_image(x))), '')
    if isinstance(value,dict):
        return first_image(value.get('url_default') or value.get('url') or value.get('url_list') or value.get('info_list') or value.get('image_scene_list'))
    return ''

def count(value):
    if isinstance(value,(int,float)) and value>=0: return int(value)
    if isinstance(value,str) and value.isdigit(): return int(value)
    return None

def normalize(payload, platform):
    rows=[]
    # Different TikHub upstream versions wrap the platform payload in data.
    data=payload.get('data',{})
    if isinstance(data,dict) and isinstance(data.get('data'),dict): data=data['data']
    if isinstance(data,list): items=data; meta=payload
    elif isinstance(data,dict): items=data.get('items') or data.get('data') or data.get('aweme_list') or []; meta=data
    else: items=[]; meta={}
    if not isinstance(items,list): raise ValueError('TikHub 搜索响应结构不符合预期')
    for item in items[:100]:
        if not isinstance(item,dict): continue
        note=item.get('note') or item.get('note_card') or item.get('aweme_info') or item
        if not isinstance(note,dict): continue
        ident=str(note.get('note_id') or note.get('id') or '') if platform=='xiaohongshu' else str(note.get('aweme_id') or '')
        import re
        if not re.fullmatch(r'[a-fA-F0-9]{24}' if platform=='xiaohongshu' else r'\d{8,25}',ident): continue
        title=note.get('display_title') or note.get('title') or note.get('desc') or ''
        if not isinstance(title,str) or not title.strip(): continue
        author=note.get('user') or note.get('author') or {}
        stats=note.get('interact_info') or note.get('statistics') or note
        published=note.get('timestamp') or note.get('time') or note.get('create_time') or note.get('publish_time')
        try:
            stamp=float(published);stamp=stamp/1000 if stamp>1e12 else stamp
            published=datetime.fromtimestamp(stamp,timezone.utc).isoformat() if 0<stamp<4102444800 else None
        except (TypeError,ValueError,OverflowError): published=None
        cover=first_image(note.get('cover') or note.get('images_list') or note.get('image_list') or note.get('images') or (note.get('video') or {}).get('cover'))
        url=safe_url(note.get('share_url') or note.get('url'))
        if not url or urlparse(url).hostname not in ('www.xiaohongshu.com','xiaohongshu.com','xhslink.com','xhslink.cn','www.douyin.com','douyin.com'):
            url=('https://www.xiaohongshu.com/explore/' if platform=='xiaohongshu' else 'https://www.douyin.com/video/')+ident
            if platform=='xiaohongshu' and isinstance(note.get('xsec_token'),str):
                from urllib.parse import urlencode
                url+='?'+urlencode({'xsec_token':note['xsec_token'],'xsec_source':'pc_search'})
        rows.append({'id':ident,'platform':platform,'title':title[:300],'cover':cover,'author':str(author.get('nickname') or author.get('name') or '')[:100], 'url':url,'publishedAt':published,'collectedAt':datetime.now(timezone.utc).isoformat(),'metrics':{'likes':count(stats.get('liked_count',stats.get('digg_count'))),'comments':count(stats.get('comment_count',stats.get('comments_count'))),'collects':count(stats.get('collected_count',stats.get('collect_count'))),'shares':count(stats.get('share_count',stats.get('shared_count')))}})
    log=meta.get('log_pb') or {}
    session={'page':1,'cursor':meta.get('cursor',0),'search_id':meta.get('search_id') or log.get('impr_id') or '', 'search_session_id':meta.get('search_session_id','')}
    more=bool(meta.get('has_more',meta.get('hasMore',False)))
    # XHS sometimes omits has_more; one additional explicitly requested page is allowed.
    if platform=='xiaohongshu' and 'has_more' not in meta: more=bool(rows)
    return rows,session,more

class PostService:
    def __init__(self,settings):
        self.settings=settings; self.sessions={}; self.cache={}; self.locks={}; self.semaphore=asyncio.Semaphore(2)

    async def search(self,request,phase):
        if not self.settings.tikhub_api_key.get_secret_value(): raise ValueError('平台检索服务尚未配置，请联系管理员')
        key=(request.platform,request.query,request.sort,request.period,request.cursor)
        # Sharing a short cache also coalesces identical concurrent searches.
        lock=self.locks.setdefault(key,asyncio.Lock())
        try:
            async with lock:
                if key in self.cache and self.cache[key][0]>time.monotonic(): return self.cache[key][1]
                if len(self.cache)>100: self.cache={k:v for k,v in self.cache.items() if v[0]>time.monotonic()}
                self.sessions={k:v for k,v in self.sessions.items() if v['expires']>time.monotonic()}
                state=self.sessions.get(request.cursor) if request.cursor else None
                if request.cursor and (not state or state['filters']!=key[:4]): raise ValueError('分页已过期或条件已变化，请重新搜索')
                state=state or {'page':1,'cursor':0,'search_id':'','search_session_id':'','seen':set(),'filters':key[:4]}
                phase('正在检索真实帖子')
                days={'不限':0,'近7天':7,'近30天':30,'近90天':90,'近半年':180}[request.period]
                headers={'Authorization':'Bearer '+self.settings.tikhub_api_key.get_secret_value()}
                async with self.semaphore, httpx.AsyncClient(base_url=self.settings.tikhub_base_url.rstrip('/'),timeout=60,follow_redirects=False) as client:
                    if request.platform=='xiaohongshu':
                        params={'keyword':request.query,'page':state['page'],'search_id':state['search_id'],'search_session_id':state['search_session_id'],'sort_type':{'general':'general','latest':'time_descending','likes':'popularity_descending'}[request.sort],'time_filter':'一周内' if days==7 else '半年内' if days else '不限','ai_mode':0}
                        response=await client.get('/api/v1/xiaohongshu/app_v2/search_notes',params=params,headers=headers)
                    else:
                        params={'keyword':request.query,'cursor':state['cursor'],'search_id':state['search_id'],'sort_type':{'general':'0','latest':'2','likes':'1'}[request.sort],'publish_time':str(7 if days==7 else 180 if days else 0),'filter_duration':'0','content_type':'0','backtrace':''}
                        response=await client.post('/api/v1/douyin/search/fetch_general_search_v1',json=params,headers=headers)
                if response.status_code!=200:
                    if response.status_code == 402:
                        try:
                            detail=response.json().get('detail', {})
                            message=detail.get('message', '') if isinstance(detail,dict) else ''
                        except (ValueError,AttributeError): message=''
                        if 'does not accept free credit' in message.lower():
                            raise ValueError('当前搜索接口不支持免费额度，付费余额不足；请在 TikHub 控制台核对接口计费')
                    raise ValueError({401:'TikHub 密钥无效',403:'TikHub 接口未获授权',402:'TikHub 额度不足',429:'TikHub 请求限流，请稍后重试'}.get(response.status_code,'TikHub 请求失败（HTTP '+str(response.status_code)+'）'))
                if len(response.content)>10*1024*1024: raise ValueError('TikHub 响应超过大小限制')
                payload=response.json()
                if payload.get('code') not in (None,0,200): raise ValueError('TikHub 返回业务错误，请检查接口权限或额度')
                rows,next_state,more=normalize(payload,request.platform)
                fresh=[]; seen=set(state['seen']); unknown=0
                for row in rows:
                    if row['id'] in seen: continue
                    seen.add(row['id'])
                    if days:
                        if not row['publishedAt']: unknown+=1; continue
                        if (datetime.now(timezone.utc)-datetime.fromisoformat(row['publishedAt'])).total_seconds()>days*86400: continue
                    fresh.append(row)
                cursor=None
                if more and len(seen)>len(state['seen']):
                    cursor=uuid.uuid4().hex
                    self.sessions[cursor]={**next_state,'page':state['page']+1,'seen':seen,'filters':key[:4],'expires':time.monotonic()+1800}
                result={'posts':fresh,'cursor':cursor,'notice':('当前周期按已返回的发布时间筛选；'+str(unknown)+' 条日期缺失内容未计入。') if days else '结果来自本次检索，不代表平台全量内容。'}
                self.cache[key]=(time.monotonic()+60,result)
                return result
        except httpx.TimeoutException: raise ValueError('TikHub 请求超时，请重试') from None
        except httpx.RequestError: raise ValueError('TikHub 服务连接失败') from None
        finally:
            if not lock.locked(): self.locks.pop(key,None)

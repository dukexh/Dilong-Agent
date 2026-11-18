import asyncio
import time
from types import SimpleNamespace
from fastapi.testclient import TestClient
from backend.main import create_app, ModelRequest
from backend.config import Settings
from backend.models import validate_rank
from backend.posts import normalize,PostService

def settings(**kw): return Settings(_env_file=None,model_usage_log=None,**kw)
def wait(client,ident):
    for _ in range(100):
        row=client.get('/api/jobs/'+ident).json()
        if row['state'] in ('succeeded','failed','cancelled'):return row
        time.sleep(.01)
    raise AssertionError('task did not finish')

def test_configuration_and_missing_credentials():
    with TestClient(create_app(settings())) as client:
        assert client.get('/api/health').json()['modelConfigured'] is False
        ident=client.post('/api/model/tasks',json={'kind':'terms','query':'木纹'}).json()['id']
        assert '未配置' in wait(client,ident)['error']
        ident=client.post('/api/posts/search',json={'platform':'douyin','query':'木纹'}).json()['id']
        assert '未配置' in wait(client,ident)['error']

def test_model_queue_and_cancel():
    app=create_app(settings(model_api_key='SECRET',model_name='test',model_base_url='https://example.com/v1'))
    active=0;maximum=0
    async def model(body,phase):
        nonlocal active,maximum
        active+=1;maximum=max(maximum,active)
        try:await asyncio.sleep(.1);return {'terms':['木纹']}
        finally:active-=1
    app.state.model.run=model
    with TestClient(app) as client:
        first=client.post('/api/model/tasks',json={'kind':'terms'}).json()['id']
        second=client.post('/api/model/tasks',json={'kind':'terms'}).json()['id']
        client.post('/api/jobs/'+second+'/cancel')
        assert wait(client,first)['state']=='succeeded'
        assert wait(client,second)['state']=='cancelled'
        assert maximum==1
        assert 'SECRET' not in client.get('/api/model/status').text
        assert client.get('/api/jobs/not-found').status_code==404

def test_validation_and_origin():
    with TestClient(create_app(settings())) as client:
        assert client.post('/api/model/tasks',json={'kind':'rank','images':[],'candidates':[]}).status_code==400
        assert client.post('/api/model/tasks',json={'kind':'probe','images':['https://evil/']}).status_code==422
        assert client.post('/api/posts/search',json={'platform':'bad','query':'x'}).status_code==422
        assert client.get('/api/health',headers={'origin':'https://evil.example'}).status_code==403
        assert client.get('/api/health',headers={'sec-fetch-site':'cross-site'}).status_code==403
        assert validate_rank({'matches':[{'id':'unknown'},{'id':'a','reason':'ok'},{'id':'a'}]},['a'])==[{'id':'a','reason':'ok'}]

def test_normalize_posts():
    payload={'data':{'items':[{'note':{'id':'a'*24,'title':'木纹','user':{'nickname':'作者'},'cover':{'url_default':'https://image.example/a.jpg'},'liked_count':'10','timestamp':1700000000}}, {'model_type':'user','user':{'id':'x'}}], 'search_id':'s','search_session_id':'ss','has_more':True}}
    rows,page,more=normalize(payload,'xiaohongshu')
    assert len(rows)==1 and rows[0]['metrics']['likes']==10 and page['search_id']=='s' and more
    assert rows[0]['metrics']['comments'] is None
    rows,page,more=normalize({'data':{'data':[{'aweme_info':{'aweme_id':'1234567890123456789','desc':'木纹','video':{'cover':{'url_list':['https://a.example/b.jpg']}},'statistics':{'digg_count':5}}}], 'cursor':10,'has_more':1,'log_pb':{'impr_id':'s'}}},'douyin')
    assert len(rows)==1 and page['cursor']==10 and page['search_id']=='s' and rows[0]['cover']

def test_tikhub_cache_and_page(monkeypatch):
    calls=[]
    class Client:
        def __init__(self,**kw): pass
        async def __aenter__(self):return self
        async def __aexit__(self,*args):pass
        async def get(self,path,**kw):
            calls.append(kw);page=kw['params']['page']
            note={'id':('a' if page==1 else 'b')*24,'title':'木纹'}
            payload={'code':200,'data':{'items':[{'note':note}],'has_more':page==1,'search_id':'search','search_session_id':'session'}}
            return SimpleNamespace(status_code=200,content=b'{}',json=lambda:payload)
    monkeypatch.setattr('backend.posts.httpx.AsyncClient',Client)
    from backend.main import SearchRequest
    async def run():
        service=PostService(settings(tikhub_api_key='key'));request=SearchRequest(platform='xiaohongshu',query='wood')
        a,b=await asyncio.gather(service.search(request,lambda _:None),service.search(request,lambda _:None))
        assert a==b and len(calls)==1
        c=await service.search(SearchRequest(platform='xiaohongshu',query='wood',cursor=a['cursor']),lambda _:None)
        assert c['posts'][0]['id']=='b'*24 and calls[1]['params']['search_id']=='search'
    asyncio.run(run())

def test_tikhub_paid_only_error_preserves_actual_reason(monkeypatch):
    import httpx
    import pytest
    from backend.main import SearchRequest
    class Client:
        def __init__(self,**kwargs):pass
        async def __aenter__(self):return self
        async def __aexit__(self,*args):pass
        async def get(self,*args,**kwargs):
            return httpx.Response(402,json={'detail':{'message':'This endpoint does not accept free credit'}})
    monkeypatch.setattr('backend.posts.httpx.AsyncClient',Client)
    with pytest.raises(ValueError,match='不支持免费额度'):
        asyncio.run(PostService(settings(tikhub_api_key='test-key')).search(SearchRequest(platform='xiaohongshu',query='wood'),lambda _:None))

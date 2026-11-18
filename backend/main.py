import asyncio
import time
import uuid
import base64
from contextlib import asynccontextmanager
from typing import Literal
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field, field_validator
from .config import Settings
from .models import ModelService
from .posts import PostService

class ModelRequest(BaseModel):
    kind: Literal['terms','rank','generate','edit','probe']
    query: str = Field(default='',max_length=4000)
    images: list[str] = Field(default_factory=list,max_length=21)
    candidates: list[dict] = Field(default_factory=list,max_length=20)
    rank_policy: Literal['all','filter'] = 'all'
    has_reference: bool | None = None
    @field_validator('images')
    @classmethod
    def valid_images(cls,images):
        import re
        for image in images:
            if len(image)>14*1024*1024 or not re.fullmatch(r'data:image/(?:png|jpeg|webp);base64,[A-Za-z0-9+/=]+',image): raise ValueError('图片格式或大小无效')
            base64.b64decode(image.split(',',1)[1],validate=True)
        return images
    @field_validator('candidates')
    @classmethod
    def valid_candidates(cls,rows):
        if any(not isinstance(r.get('id'),str) or len(r['id'])>200 for r in rows): raise ValueError('候选编号无效')
        if len({r['id'] for r in rows})!=len(rows): raise ValueError('候选编号重复')
        return rows

class SearchRequest(BaseModel):
    platform: Literal['xiaohongshu','douyin']
    query: str = Field(min_length=1,max_length=150)
    sort: Literal['general','latest','likes'] = 'general'
    period: Literal['不限','近7天','近30天','近90天','近半年'] = '不限'
    cursor: str | None = Field(default=None,max_length=100)

class Jobs:
    def __init__(self): self.rows={};self.tasks={};self.model_lane=asyncio.Semaphore(1)
    def create(self,action,model=False,timeout=600):
        self.prune()
        if sum(not t.done() for t in self.tasks.values())>=20: raise ValueError('任务队列已满，请稍后重试')
        ident=uuid.uuid4().hex;row={'id':ident,'state':'queued','phase':'等待执行','updatedAt':time.time()};self.rows[ident]=row
        async def run():
            try:
                async def execute():
                    row.update(state='running',phase='正在执行')
                    def phase(text): row.update(phase=text,updatedAt=time.time())
                    row['result']=await asyncio.wait_for(action(phase),timeout=timeout)
                    row.update(state='succeeded',phase='已完成')
                if model:
                    async with self.model_lane: await execute()
                else: await execute()
            except asyncio.CancelledError: row.update(state='cancelled',phase='任务已取消',error='任务已取消')
            except TimeoutError: row.update(state='failed',phase='任务超时',error='任务超时，请重试')
            except ValueError as e:
                row.update(state='failed',phase='执行失败',error=str(e))
                if getattr(e,'model_usage',None): row['usage']=e.model_usage
            except Exception: row.update(state='failed',phase='执行失败',error='服务响应异常，请检查后端配置及接口兼容性')
            finally: row['updatedAt']=time.time()
        self.tasks[ident]=asyncio.create_task(run());return {'id':ident,'state':'queued'}
    def prune(self):
        for ident,row in list(self.rows.items()):
            if self.tasks[ident].done() and row['updatedAt']<time.time()-3600: self.rows.pop(ident);self.tasks.pop(ident)

def create_app(settings=None):
    cfg=settings or Settings();jobs=Jobs();model=ModelService(cfg);posts=PostService(cfg)
    @asynccontextmanager
    async def lifespan(app):
        async def prune():
            while True:
                await asyncio.sleep(60)
                jobs.prune()
        cleaner=asyncio.create_task(prune())
        yield
        cleaner.cancel()
        await asyncio.gather(cleaner,return_exceptions=True)
        for t in jobs.tasks.values(): t.cancel()
        await asyncio.gather(*jobs.tasks.values(),return_exceptions=True)
    app=FastAPI(title='帝龙本地服务',lifespan=lifespan)
    app.state.jobs=jobs;app.state.model=model;app.state.posts=posts
    limits={}
    @app.middleware('http')
    async def guard(request:Request,call_next):
        origin=request.headers.get('origin');host=request.headers.get('host','')
        if origin and origin not in cfg.allowed_origins.split(',') and origin not in ('http://'+host,'https://'+host): return JSONResponse({'error':'请求来源未获允许'},403)
        if request.headers.get('sec-fetch-site')=='cross-site': return JSONResponse({'error':'不接受跨站请求'},403)
        if request.method=='POST':
            peer=request.client.host if request.client else 'unknown';now=time.monotonic()
            limits[peer]=[t for t in limits.get(peer,[]) if t>now-60]
            if len(limits[peer])>=30: return JSONResponse({'error':'操作过于频繁，请稍后重试'},429)
            limits[peer].append(now)
            # Bound the request before JSON parsing, including chunked bodies.
            body=bytearray()
            async for chunk in request.stream():
                body.extend(chunk)
                if len(body)>32*1024*1024: return JSONResponse({'error':'请求超过32 MB'},413)
            request._body=bytes(body)
        return await call_next(request)
    @app.exception_handler(ValueError)
    async def invalid(request,error): return JSONResponse({'error':str(error)},400)
    from fastapi.exceptions import RequestValidationError
    @app.exception_handler(RequestValidationError)
    async def validation(request,error): return JSONResponse({'error':'请求参数无效，请检查输入数量、长度或格式'},422)
    @app.get('/api/health')
    async def health(): return {'ok':True,'storage':'browser','modelConfigured':cfg.model_ready,'imageModelConfigured':cfg.image_model_ready,'tikhubConfigured':bool(cfg.tikhub_api_key.get_secret_value())}
    @app.get('/api/model/status')
    async def status(): return {'configured':cfg.model_ready,'available':cfg.model_ready,'imageConfigured':cfg.image_model_ready,'model':cfg.model_name,'imageModel':cfg.image_model_name,'message':'模型服务已配置' if cfg.model_ready else '模型服务未配置'}
    @app.get('/api/platforms')
    async def platforms(): return {'provider':'tikhub','configured':bool(cfg.tikhub_api_key.get_secret_value())}
    @app.get('/api/model/usage')
    async def usage(): return {'records':model.ledger.rows[-100:]}
    @app.post('/api/model/tasks',status_code=202)
    async def model_task(body:ModelRequest):
        if body.kind=='rank' and (not body.candidates or len(body.images) not in (len(body.candidates),len(body.candidates)+1)): raise ValueError('候选图片与编号数量不一致')
        if body.kind=='rank' and body.has_reference is not None and len(body.images)!=len(body.candidates)+int(body.has_reference): raise ValueError('参考图与候选图片数量不一致')
        if body.kind in ('generate','edit') and any(len(base64.b64decode(image.split(',',1)[1]))>10000000 for image in body.images): raise ValueError('参考图片超过模型10MB输入限制')
        return jobs.create(lambda phase:model.run(body,phase),True,timeout=720 if body.kind in ('generate','edit') else 600)
    @app.post('/api/posts/search',status_code=202)
    async def search(body:SearchRequest):
        if not body.query.strip(): raise ValueError('请输入搜索关键词')
        body.query=body.query.strip();return jobs.create(lambda phase:posts.search(body,phase))
    @app.get('/api/jobs/{ident}')
    async def job(ident:str):
        row=jobs.rows.get(ident)
        return row if row else JSONResponse({'error':'任务不存在或服务已重启，请重新执行'},404)
    @app.post('/api/jobs/{ident}/cancel')
    @app.delete('/api/jobs/{ident}')
    async def cancel(ident:str,request:Request):
        task=jobs.tasks.get(ident)
        if task and not task.done(): task.cancel()
        elif request.method=='DELETE': jobs.tasks.pop(ident,None);jobs.rows.pop(ident,None)
        return {'ok':True}
    return app

app=create_app()

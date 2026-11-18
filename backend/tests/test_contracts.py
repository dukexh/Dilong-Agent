import asyncio
import json
import httpx
import pytest
from openai import AsyncOpenAI
from backend.config import Settings
from backend.main import ModelRequest
from backend.models import ModelService

IMAGE='data:image/png;base64,aGVsbG8='

@pytest.mark.parametrize('policy,expected', [('all',['b','a','c']),('filter',['b'])])
def test_rank_policy_and_usage_are_enforced(monkeypatch,tmp_path,policy,expected):
    requests=[]
    def respond(request):
        body=json.loads(request.content);requests.append(body)
        return httpx.Response(200,json={'choices':[{'message':{'role':'assistant','content':'{"matches":[{"id":"b"},{"id":"unknown"},{"id":"b"}]}'},'finish_reason':'stop'}],'usage':{'prompt_tokens':234,'completion_tokens':100,'completion_tokens_details':{'reasoning_tokens':50}}})
    def factory(**kwargs):return AsyncOpenAI(**kwargs,http_client=httpx.AsyncClient(transport=httpx.MockTransport(respond)))
    monkeypatch.setattr('backend.models.AsyncOpenAI',factory)
    log=tmp_path/'usage.json'
    service=ModelService(Settings(_env_file=None,model_api_key='private-test-key',model_usage_log=log))
    result=asyncio.run(service.run(ModelRequest(kind='rank',rank_policy=policy,has_reference=False,images=[IMAGE]*3,candidates=[{'id':c} for c in 'abc']),lambda _:None))
    assert [r['id'] for r in result['matches']]==expected
    assert result['omittedCount']==2
    assert result['usage']['inputTokens']==234 and result['usage']['reasoningTokens']==50
    assert requests[0]['max_completion_tokens']==4096 and requests[0]['thinking_budget']==1024
    texts=[r['text'] for r in requests[0]['messages'][1]['content'] if r['type']=='text']
    assert any('候选编号：c'==t for t in texts)
    saved=json.loads(log.read_text());assert saved[0]['status']=='succeeded'
    assert 'private-test-key' not in log.read_text() and IMAGE not in log.read_text()

def test_truncated_output_keeps_reported_usage_on_failure(monkeypatch,tmp_path):
    def factory(**kwargs):
        response={'choices':[{'finish_reason':'length','message':{'role':'assistant','content':'{'}}],'usage':{'prompt_tokens':123,'completion_tokens':4096}}
        return AsyncOpenAI(**kwargs,http_client=httpx.AsyncClient(transport=httpx.MockTransport(lambda _:httpx.Response(200,json=response))))
    monkeypatch.setattr('backend.models.AsyncOpenAI',factory)
    service=ModelService(Settings(_env_file=None,model_api_key='test',model_usage_log=tmp_path/'usage.json'))
    with pytest.raises(ValueError,match='长度预算') as error:asyncio.run(service.run(ModelRequest(kind='terms'),lambda _:None))
    assert error.value.model_usage['outputTokens']==4096
    assert service.ledger.rows[-1]['status']=='failed'


@pytest.mark.parametrize('model,budget,extra', [('qwen4-max',0,{'enable_thinking':False}),('other-compatible-model',1024,{})])
def test_optional_thinking_and_empty_text_matches(monkeypatch,model,budget,extra):
    requests=[]
    def respond(request):
        requests.append(json.loads(request.content))
        return httpx.Response(200,json={'choices':[{'message':{'role':'assistant','content':'{"matches":[]}'},'finish_reason':'stop'}]})
    def factory(**kwargs):return AsyncOpenAI(**kwargs,http_client=httpx.AsyncClient(transport=httpx.MockTransport(respond)))
    monkeypatch.setattr('backend.models.AsyncOpenAI',factory)
    service=ModelService(Settings(_env_file=None,model_api_key='test',model_usage_log=None,model_name=model,model_thinking_budget=budget))
    result=asyncio.run(service.run(ModelRequest(kind='rank',rank_policy='filter',has_reference=False,images=[IMAGE],candidates=[{'id':'a'}]),lambda _:None))
    assert result['matches']==[]
    assert {k:requests[0][k] for k in ('thinking_budget','enable_thinking') if k in requests[0]}==extra
    assert result['usage']['inputTokens'] is None


def test_usage_write_failure_does_not_discard_successful_response(monkeypatch,tmp_path):
    def factory(**kwargs):
        return AsyncOpenAI(**kwargs,http_client=httpx.AsyncClient(transport=httpx.MockTransport(lambda _:httpx.Response(200,json={'choices':[{'message':{'role':'assistant','content':'{"terms":["wood"]}'}}]}))))
    monkeypatch.setattr('backend.models.AsyncOpenAI',factory)
    service=ModelService(Settings(_env_file=None,model_api_key='test',model_usage_log=tmp_path/'usage.json'))
    def failed_write():raise OSError('controlled disk failure')
    monkeypatch.setattr(service.ledger,'_write',failed_write)
    result=asyncio.run(service.run(ModelRequest(kind='terms',query='wood'),lambda _:None))
    assert result['terms']==['wood'] and result['usage']['recorded'] is False
    assert service.ledger.rows[-1]['recorded'] is False

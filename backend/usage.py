import asyncio
import json
from pathlib import Path


class UsageLedger:
    """Bounded local metadata ledger; never stores keys, prompts or image content."""
    def __init__(self, path: Path | None):
        self.path, self.rows, self.lock = path, [], asyncio.Lock()
        if path and path.exists():
            try:
                self.rows = json.loads(path.read_text(encoding='utf-8'))[-1000:]
            except (OSError, ValueError, TypeError):
                self.rows = []

    async def record(self, row):
        async with self.lock:
            stored = dict(row, recorded=True)
            self.rows = (self.rows + [stored])[-1000:]
            if not self.path:
                return True
            try:
                await asyncio.to_thread(self._write)
                return True
            except OSError:
                stored['recorded'] = False
                return False

    def _write(self):
        self.path.parent.mkdir(parents=True, exist_ok=True)
        temporary = self.path.with_suffix('.tmp')
        temporary.write_text(json.dumps(self.rows, ensure_ascii=False), encoding='utf-8')
        temporary.replace(self.path)


def reported_usage(value):
    if hasattr(value, 'model_dump'):
        value = value.model_dump()
    value = value if isinstance(value, dict) else {}
    def number(key):
        v = value.get(key)
        return v if isinstance(v, int) and not isinstance(v, bool) and v >= 0 else None
    details = value.get('completion_tokens_details') or {}
    reasoning = details.get('reasoning_tokens') if isinstance(details, dict) else None
    return {'inputTokens': number('prompt_tokens') if number('prompt_tokens') is not None else number('input_tokens'),
            'outputTokens': number('completion_tokens') if number('completion_tokens') is not None else number('output_tokens'),
            'reasoningTokens': reasoning if isinstance(reasoning,int) and not isinstance(reasoning,bool) and reasoning>=0 else None}

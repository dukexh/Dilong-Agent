from pathlib import Path
from typing import Literal
from pydantic import SecretStr, Field
from pydantic_settings import BaseSettings, SettingsConfigDict

class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=Path(__file__).with_name('.env'), extra='ignore')
    model_base_url: str = 'https://dashscope.aliyuncs.com/compatible-mode/v1'
    model_api_key: SecretStr = SecretStr('')
    model_name: str = 'qwen4-max'
    image_model_name: str = 'qwen-image-3.0-pro'
    image_api_protocol: Literal['dashscope', 'openai'] = 'dashscope'
    model_max_output_tokens: int = Field(default=4096, ge=512, le=32768)
    model_thinking_budget: int = Field(default=1024, ge=0, le=16384)
    model_usage_log: Path | None = Path(__file__).resolve().parents[1] / '.dilong-runtime/model-usage.json'
    tikhub_base_url: str = 'https://api.tikhub.io'
    tikhub_api_key: SecretStr = SecretStr('')
    allowed_origins: str = 'http://127.0.0.1:51458,http://localhost:51458,http://127.0.0.1:51459'

    @property
    def model_ready(self):
        return bool(self.model_base_url and self.model_name and self.model_api_key.get_secret_value())

    @property
    def image_model_ready(self):
        return bool(self.model_base_url and self.image_model_name and self.model_api_key.get_secret_value())

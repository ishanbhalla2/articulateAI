import os

PROMPT_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "prompts")


def load_prompt(version: str) -> str:
    with open(os.path.join(PROMPT_DIR, f"{version}.md"), encoding="utf-8") as f:
        return f.read()

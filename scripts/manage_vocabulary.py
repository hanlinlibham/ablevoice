"""DashScope paraformer-realtime-v2 自定义热词词表管理 CLI.

Why this exists
===============
``paraformer-realtime-v2`` 支持 per-call ``vocabulary_id`` 做热词偏置 ——
显著提升金融术语 (宁德时代/科创50/贵州茅台) 和工作区名等专有名词的识别
命中率。词表本身由 DashScope 云端持有,**不进 .env**,通过 SDK 上传 /
更新 / 列出 / 删除。

实际跑起来后把返回的 ``vocabulary_id`` 写进 ``.env.local`` ::

    DASHSCOPE_ASR_VOCABULARY_ID=vocab-asr-ablv-20260528-xxxxxxxx

Usage
=====
::

    # 1. 拼装一份初始词表 (从工作区列表 + 静态金融词)
    python scripts/manage_vocabulary.py create --prefix ablv \\
        --from-workspaces                                   \\
        --static financial_terms.txt

    # 2. 增量更新现有词表 (添加新工作区名)
    python scripts/manage_vocabulary.py update --id vocab-asr-... \\
        --add "新工作区名" --add "另一个名字"

    # 3. 列出当前账户下所有热词
    python scripts/manage_vocabulary.py list

    # 4. 删除 (上线新词表后清理旧的)
    python scripts/manage_vocabulary.py delete --id vocab-asr-old-...

Notes
=====
- 每个热词支持权重 1–5;默认 4(显著但不强到淹没正常识别)
- ``--from-workspaces`` 走 ablework backend 拉用户工作区列表,需要
  ABLEWORK_TOKEN 在 .env.local 里;失败时跳过此项
- DashScope SDK ``dashscope>=1.21`` 才有 VocabularyService;请确认版本
"""

from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path

# Add repo root to sys.path so ``voice.config`` works when run via
# ``python scripts/manage_vocabulary.py`` from the repo root.
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

# Default per-hotword weight. Range 1-5 in DashScope's spec; 4 is "noticeable
# bias without overwhelming normal recognition" — empirically a good baseline
# for proper-noun hotwords.
DEFAULT_WEIGHT = 4


def _load_api_key() -> str:
    # Load .env.local manually (no python-dotenv required for this script)
    repo_root = Path(__file__).resolve().parent.parent
    env_file = repo_root / ".env.local"
    if env_file.exists():
        for line in env_file.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            k, _, v = line.partition("=")
            k = k.strip()
            v = v.strip().strip('"').strip("'")
            if k and v and not os.environ.get(k):
                os.environ[k] = v
    key = os.environ.get("DASHSCOPE_API_KEY", "").strip()
    if not key:
        raise SystemExit("DASHSCOPE_API_KEY missing — set it in .env.local or env")
    return key


def _import_vocab_service():
    try:
        from dashscope.audio.asr import VocabularyService  # type: ignore
    except ImportError:
        raise SystemExit(
            "dashscope SDK missing — install with: pip install -U dashscope"
        )
    return VocabularyService


def _to_entries(words: list[str], weight: int, lang: str = "zh") -> list[dict]:
    """Coerce a list of plain strings into the VocabularyService entry shape."""
    out = []
    for w in words:
        w = w.strip()
        if not w:
            continue
        out.append({"text": w, "weight": weight, "lang": lang})
    return out


def _collect_words(args) -> list[str]:
    """Aggregate hotwords from the CLI args. Order: --add inline > --static
    file lines > --from-workspaces fetch. De-duplicated, order-preserving."""
    seen: set[str] = set()
    out: list[str] = []
    for w in (args.add or []):
        if w not in seen:
            seen.add(w); out.append(w)
    if args.static:
        for line in Path(args.static).read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if not line or line.startswith("#"):
                continue
            if line not in seen:
                seen.add(line); out.append(line)
    if args.from_workspaces:
        ws = _fetch_workspaces()
        for name in ws:
            if name not in seen:
                seen.add(name); out.append(name)
    return out


def _fetch_workspaces() -> list[str]:
    """Best-effort workspace list pull from ablework backend."""
    token = os.environ.get("ABLEWORK_TOKEN", "").strip()
    url = os.environ.get("ABLEWORK_URL", "https://ab.itseek.cc/api/chat").strip()
    if not token:
        print("  (skip --from-workspaces: ABLEWORK_TOKEN missing)", file=sys.stderr)
        return []
    # Derive /workspaces endpoint from /api/chat base.
    ws_url = url.rsplit("/api/chat", 1)[0] + "/api/workspaces"
    import httpx
    try:
        r = httpx.get(
            ws_url, headers={"Authorization": f"Bearer {token}"},
            timeout=10.0, verify=False,
        )
        r.raise_for_status()
        data = r.json()
        names = [w.get("name", "") for w in (data.get("workspaces") or [])]
        return [n for n in names if n]
    except Exception as exc:
        print(f"  (skip --from-workspaces: {exc})", file=sys.stderr)
        return []


def cmd_create(args) -> None:
    _load_api_key()
    Vs = _import_vocab_service()
    words = _collect_words(args)
    if not words:
        raise SystemExit("no hotwords gathered — supply --add / --static / --from-workspaces")
    entries = _to_entries(words, args.weight)
    print(f"creating vocabulary with {len(entries)} entries, prefix={args.prefix!r}…")
    svc = Vs()
    resp = svc.create_vocabulary(
        target_model=args.model, prefix=args.prefix, vocabulary=entries,
    )
    print("response:", resp)
    vocab_id = (
        getattr(resp, "output", None) and getattr(resp.output, "vocabulary_id", None)
    ) or (resp.get("output", {}) if isinstance(resp, dict) else {}).get("vocabulary_id")
    if vocab_id:
        print(f"\nvocabulary_id = {vocab_id}")
        print(f"\nadd to .env.local:")
        print(f"  DASHSCOPE_ASR_VOCABULARY_ID={vocab_id}")


def cmd_update(args) -> None:
    _load_api_key()
    Vs = _import_vocab_service()
    words = _collect_words(args)
    if not words:
        raise SystemExit("no hotwords gathered — supply --add / --static / --from-workspaces")
    entries = _to_entries(words, args.weight)
    print(f"updating {args.id} with {len(entries)} entries…")
    svc = Vs()
    resp = svc.update_vocabulary(vocabulary_id=args.id, vocabulary=entries)
    print("response:", resp)


def cmd_list(args) -> None:
    _load_api_key()
    Vs = _import_vocab_service()
    svc = Vs()
    resp = svc.list_vocabularies(prefix=args.prefix or None)
    print("response:", resp)


def cmd_delete(args) -> None:
    _load_api_key()
    Vs = _import_vocab_service()
    svc = Vs()
    resp = svc.delete_vocabulary(vocabulary_id=args.id)
    print("response:", resp)


def main() -> None:
    p = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    sub = p.add_subparsers(dest="cmd", required=True)

    common = argparse.ArgumentParser(add_help=False)
    common.add_argument("--model", default="paraformer-realtime-v2",
                        help="target ASR model (default: paraformer-realtime-v2)")
    common.add_argument("--add", action="append", default=[],
                        help="single hotword (repeatable: --add 宁德时代 --add 科创50)")
    common.add_argument("--static", help="path to text file (one word per line)")
    common.add_argument("--from-workspaces", action="store_true",
                        help="also pull workspace names from ablework backend")
    common.add_argument("--weight", type=int, default=DEFAULT_WEIGHT,
                        help=f"per-entry weight 1-5 (default: {DEFAULT_WEIGHT})")

    sc = sub.add_parser("create", parents=[common], help="create a new vocabulary")
    sc.add_argument("--prefix", required=True,
                    help="prefix tag for the vocabulary (e.g. 'ablv')")
    sc.set_defaults(func=cmd_create)

    su = sub.add_parser("update", parents=[common], help="add entries to existing vocabulary")
    su.add_argument("--id", required=True, help="existing vocabulary_id")
    su.set_defaults(func=cmd_update)

    sl = sub.add_parser("list", help="list vocabularies")
    sl.add_argument("--prefix", help="filter by prefix")
    sl.set_defaults(func=cmd_list)

    sd = sub.add_parser("delete", help="delete a vocabulary")
    sd.add_argument("--id", required=True, help="vocabulary_id to delete")
    sd.set_defaults(func=cmd_delete)

    args = p.parse_args()
    args.func(args)


if __name__ == "__main__":
    main()

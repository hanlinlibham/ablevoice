#!/usr/bin/env python3
"""独立诊断 — 不走 TUI / WS,直接调 sounddevice 录 2s + 报告 mic 状态。

跑法:./scripts/mic-check.py  (然后对着 mic 说点话)

如果这里能采到声音 → tui.py 的麦克风问题在别处
如果这里采不到 → macOS 系统设置 → 隐私 → 麦克风 加权限
"""
from __future__ import annotations

import shutil
import sys
import time

import numpy as np
import sounddevice as sd


def main() -> int:
    print("=== sounddevice 设备列表 ===")
    print(sd.query_devices())
    print()
    print(f"默认设备 (输入, 输出) = {sd.default.device}")
    try:
        in_dev = sd.query_devices(kind="input")
        print(f"默认输入设备: {in_dev['name']!r} · {in_dev['max_input_channels']} ch · {int(in_dev['default_samplerate'])} Hz native")
    except Exception as e:
        print(f"无默认输入设备:{e}")
        return 2

    print()
    print("=== 准备录 2 秒 @ 16 kHz ===")
    print("对着 mic 说话(可以数 1234) — 按 Ctrl+C 取消")
    for n in (3, 2, 1):
        print(f"  {n}…", end=" ", flush=True)
        time.sleep(0.6)
    print("录!")

    try:
        data = sd.rec(int(2 * 16000), samplerate=16000, channels=1, dtype="float32")
        # 录的同时画一个简易 level bar
        n = int(2 / 0.05)
        bar_w = 40
        for i in range(n):
            time.sleep(0.05)
            so_far = data[: int((i + 1) * 0.05 * 16000)]
            if so_far.size == 0: continue
            rms = float(np.sqrt(np.mean(so_far[:, 0] ** 2)))
            filled = int(min(1.0, rms * 3) * bar_w)
            print(f"\r  level [" + "█" * filled + "░" * (bar_w - filled) + f"]  {rms*100:5.1f}%", end="", flush=True)
        sd.wait()
        print()
    except KeyboardInterrupt:
        print("\n取消"); return 1
    except sd.PortAudioError as e:
        print(f"\n✗ PortAudioError: {e}")
        _permission_help()
        return 3
    except Exception as e:
        print(f"\n✗ 录音失败:{type(e).__name__}: {e}")
        return 4

    samples = data[:, 0]
    peak = float(np.abs(samples).max())
    rms = float(np.sqrt(np.mean(samples ** 2)))
    n_nonzero = int((np.abs(samples) > 0.0005).sum())
    print()
    print(f"=== 结果 ===")
    print(f"  RMS:       {rms:.4f}  ({rms*100:.2f}%)")
    print(f"  peak:      {peak:.4f}  ({peak*100:.2f}%)")
    print(f"  非零样本:  {n_nonzero}/{samples.size}")

    if rms < 0.001 and peak < 0.005:
        print()
        print("⚠ mic 完全没采到 — 几乎肯定是权限问题。")
        _permission_help()
        return 5

    print()
    print("✓ mic 工作正常。如果 tui.py 还不行,问题不在 mic — 把 tui 的截屏给我看。")
    return 0


def _permission_help() -> None:
    print()
    print("macOS 权限修复:")
    print("  1. 打开 System Settings → Privacy & Security → Microphone")
    print("     (或 旧版 macOS:System Preferences → Security & Privacy → Privacy → Microphone)")
    print("  2. 找到你正在用的终端 app 并 **打开**(Terminal / iTerm / Ghostty / Warp / Cursor / VS Code…)")
    print("  3. 如果列表里**没有**你的终端,Python 也不在,那 macOS 没注册过请求 — 通常是因为")
    print("     Python 的 binary 没有 NSMicrophoneUsageDescription。最简单的解法:")
    print("     在终端里跑这条强制注册(会弹窗一次):")
    print()
    print("       python3 -c \"import sounddevice; sounddevice.rec(160, samplerate=16000, channels=1); print('ok')\"")
    print()
    print("  4. 关掉 TUI、重开终端,再 ./start-tui.sh")
    print()
    # 帮 user 一行命令直接开权限面板
    if shutil.which("open"):
        print("现在帮你打开权限面板:")
        print("  open 'x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone'")


if __name__ == "__main__":
    sys.exit(main())

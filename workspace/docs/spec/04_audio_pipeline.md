# 音声処理パイプライン / Audio Processing Pipeline

## 概要 / Overview

Meetilyの音声システムは、マイクとシステム音声を同時にキャプチャし、プロフェッショナルな音声ミキシングとVAD (Voice Activity Detection) を適用して、録音とリアルタイム文字起こしを実現します。

## アーキテクチャ / Architecture

### 二重パス設計 / Dual-Path Design

音声パイプラインは**2つの並行パス**を持ちます:

```
Raw Audio (Mic + System)
         ↓
┌────────────────────────────────────────────────────────────┐
│              Audio Pipeline Manager                         │
│  (frontend/src-tauri/src/audio/pipeline.rs)                │
└─────────────┬──────────────────────────┬───────────────────┘
              ↓                          ↓
    ┌─────────────────┐        ┌─────────────────────┐
    │ Recording Path  │        │ Transcription Path  │
    │ (Pre-mixed)     │        │ (VAD-filtered)      │
    └─────────────────┘        └─────────────────────┘
              ↓                          ↓
    RecordingSaver.save()      WhisperEngine.transcribe()
```

**Recording Path**: 
- プロフェッショナル音声ミキシング (RMS-based ducking)
- クリッピング防止
- WAVファイルとして保存

**Transcription Path**:
- Voice Activity Detection (VAD)
- 音声区間のみをWhisperに送信
- リアルタイム文字起こし

## コンポーネント詳細 / Component Details

### 1. Audio Capture (音声キャプチャ)

#### マイクキャプチャ / Microphone Capture

**ファイル**: `frontend/src-tauri/src/audio/capture/microphone.rs`

```rust
pub fn create_microphone_stream(
    device: &Device,
    sample_rate: u32,
    channels: u16,
) -> Result<Stream> {
    // cpal を使用してマイク音声をキャプチャ
}
```

**サポートフォーマット**:
- サンプルレート: 48000 Hz (推奨), 44100 Hz, 16000 Hz
- チャンネル: 1 (モノラル), 2 (ステレオ)
- ビット深度: 16-bit, 32-bit float

#### システム音声キャプチャ / System Audio Capture

**ファイル**: `frontend/src-tauri/src/audio/capture/system.rs`

##### macOS (ScreenCaptureKit)
```rust
// frontend/src-tauri/src/audio/capture/core_audio.rs
pub fn create_system_audio_stream_macos(
    device_name: &str,
) -> Result<Stream> {
    // ScreenCaptureKit を使用 (macOS 13+)
    // 画面録画権限が必要
}
```

**要件**:
- macOS 13 Ventura以降
- 画面録画権限
- 仮想音声デバイス (BlackHole 2ch)

##### Windows (WASAPI)
```rust
// frontend/src-tauri/src/audio/devices/platform/windows.rs
pub fn create_system_audio_stream_windows(
    device_name: &str,
) -> Result<Stream> {
    // WASAPI loopback mode を使用
}
```

**要件**:
- Windows 7以降
- WASAPIドライバ

##### Linux (PulseAudio)
```rust
// frontend/src-tauri/src/audio/devices/platform/linux.rs
pub fn create_system_audio_stream_linux(
    device_name: &str,
) -> Result<Stream> {
    // PulseAudio monitor source を使用
}
```

### 2. Audio Pipeline Manager (音声パイプライン管理)

**ファイル**: `frontend/src-tauri/src/audio/pipeline.rs`

#### AudioMixerRingBuffer

リングバッファを使用してマイクとシステム音声を同期します。

```rust
pub struct AudioMixerRingBuffer {
    mic_buffer: VecDeque<f32>,
    system_buffer: VecDeque<f32>,
    window_size: usize,  // 50ms = 2400 samples @ 48kHz
}
```

**処理フロー**:
1. マイクとシステム音声がそれぞれ非同期に到着
2. リングバッファに蓄積
3. 両方のバッファが十分なデータ (50ms) を持ったらミキシング
4. ミキシングされた音声を2つのパスに送信

#### ProfessionalAudioMixer

プロフェッショナルな音声ミキシングを実行します。

```rust
pub struct ProfessionalAudioMixer {
    mic_gain: f32,           // マイクゲイン (default: 1.0)
    system_gain: f32,        // システム音声ゲイン (default: 0.4)
    ducking_threshold: f32,  // ダッキング閾値 (default: 0.1)
    ducking_amount: f32,     // ダッキング量 (default: 0.3)
}
```

**ミキシングアルゴリズム**:
```rust
pub fn mix(&self, mic_samples: &[f32], system_samples: &[f32]) -> Vec<f32> {
    let mic_rms = calculate_rms(mic_samples);
    
    // マイクが話しているときはシステム音声を下げる (ducking)
    let system_gain = if mic_rms > self.ducking_threshold {
        self.system_gain * self.ducking_amount
    } else {
        self.system_gain
    };
    
    // ミキシング + クリッピング防止
    let mixed: Vec<f32> = mic_samples.iter()
        .zip(system_samples.iter())
        .map(|(m, s)| {
            let mixed = (m * self.mic_gain) + (s * system_gain);
            mixed.clamp(-1.0, 1.0)  // クリッピング防止
        })
        .collect();
    
    mixed
}
```

**RMS計算** (Root Mean Square):
```rust
fn calculate_rms(samples: &[f32]) -> f32 {
    let sum_squares: f32 = samples.iter().map(|s| s * s).sum();
    (sum_squares / samples.len() as f32).sqrt()
}
```

### 3. Voice Activity Detection (VAD)

**ファイル**: `frontend/src-tauri/src/audio/pipeline.rs`

```rust
pub struct SimpleVAD {
    energy_threshold: f32,   // エネルギー閾値 (default: 0.02)
    min_speech_duration: usize,  // 最小音声時間 (frames)
    speech_frame_count: usize,   // 連続音声フレーム数
}

impl SimpleVAD {
    pub fn is_speech(&mut self, samples: &[f32]) -> bool {
        let energy = calculate_rms(samples);
        
        if energy > self.energy_threshold {
            self.speech_frame_count += 1;
        } else {
            self.speech_frame_count = 0;
        }
        
        self.speech_frame_count >= self.min_speech_duration
    }
}
```

**効果**:
- 無音区間をWhisperに送信しないことで処理負荷を約70%削減
- 不要な「...」や空のトランスクリプトを防止

### 4. Recording Saver (録音保存)

**ファイル**: `frontend/src-tauri/src/audio/recording_saver.rs`

```rust
pub struct RecordingSaver {
    file_path: PathBuf,
    sample_rate: u32,
    channels: u16,
    wav_writer: WavWriter<BufWriter<File>>,
}

impl RecordingSaver {
    pub async fn save_chunk(&mut self, samples: &[f32]) -> Result<()> {
        // f32 samples を i16 に変換
        let samples_i16: Vec<i16> = samples.iter()
            .map(|s| (s * 32767.0) as i16)
            .collect();
        
        // WAVファイルに書き込み
        for sample in samples_i16 {
            self.wav_writer.write_sample(sample)?;
        }
        
        Ok(())
    }
}
```

**保存場所**:
- **macOS**: `~/Documents/Meetily/recordings/`
- **Windows**: `%USERPROFILE%\Documents\Meetily\recordings\`

**ファイル形式**:
- フォーマット: WAV (RIFF)
- サンプルレート: 48000 Hz
- ビット深度: 16-bit PCM
- チャンネル: 2 (ステレオ)

### 5. Whisper Integration (文字起こし)

**ファイル**: `frontend/src-tauri/src/whisper_engine/whisper_engine.rs`

```rust
pub struct WhisperEngine {
    model: Option<WhisperModel>,
    context: Option<WhisperContext>,
    model_name: String,
}

impl WhisperEngine {
    pub async fn transcribe(&self, audio_samples: &[f32]) -> Result<String> {
        // VADでフィルタされた音声のみを処理
        let ctx = self.context.as_ref().unwrap();
        
        // Whisper.cpp で文字起こし
        let result = ctx.full(audio_samples)?;
        
        Ok(result.text)
    }
}
```

**GPU加速**:
- **macOS**: Metal + CoreML (自動有効化)
- **Windows/Linux**: CUDA (NVIDIA), Vulkan (AMD/Intel)
- **CPU**: OpenBLAS (フォールバック)

**処理速度**:
- GPU: リアルタイムファクター 0.1-0.3x (10倍高速)
- CPU: リアルタイムファクター 1.0-2.0x

## デバイス管理 / Device Management

### モジュール構造

```
audio/
├── devices/
│   ├── discovery.rs           # デバイス検出
│   ├── microphone.rs          # デフォルトマイク取得
│   ├── speakers.rs            # デフォルトスピーカー取得
│   ├── configuration.rs       # デバイス設定
│   └── platform/
│       ├── windows.rs         # Windows WASAPI
│       ├── macos.rs           # macOS ScreenCaptureKit
│       └── linux.rs           # Linux ALSA/PulseAudio
```

### デバイス検出

```rust
// frontend/src-tauri/src/audio/devices/discovery.rs
pub fn list_audio_devices() -> Result<AudioDeviceList> {
    let host = cpal::default_host();
    
    let input_devices: Vec<AudioDevice> = host.input_devices()?
        .filter_map(|device| device.name().ok())
        .map(|name| AudioDevice {
            name,
            is_default: false,
        })
        .collect();
    
    let output_devices: Vec<AudioDevice> = host.output_devices()?
        .filter_map(|device| device.name().ok())
        .map(|name| AudioDevice {
            name,
            is_default: false,
        })
        .collect();
    
    Ok(AudioDeviceList {
        input_devices,
        output_devices,
    })
}
```

## パフォーマンス最適化 / Performance Optimizations

### 1. バッファプール

```rust
// frontend/src-tauri/src/audio/buffer_pool.rs
pub struct AudioBufferPool {
    pool: Vec<Vec<f32>>,
    capacity: usize,
}

impl AudioBufferPool {
    pub fn acquire(&mut self) -> Vec<f32> {
        self.pool.pop().unwrap_or_else(|| Vec::with_capacity(self.capacity))
    }
    
    pub fn release(&mut self, mut buffer: Vec<f32>) {
        buffer.clear();
        self.pool.push(buffer);
    }
}
```

**効果**: メモリアロケーションを削減し、レイテンシを低減

### 2. メトリクスバッチング

```rust
// frontend/src-tauri/src/audio/pipeline.rs
pub struct AudioMetricsBatcher {
    batch_size: usize,
    current_batch: Vec<AudioMetrics>,
}

impl AudioMetricsBatcher {
    pub fn add(&mut self, metrics: AudioMetrics) {
        self.current_batch.push(metrics);
        
        if self.current_batch.len() >= self.batch_size {
            self.flush();
        }
    }
    
    fn flush(&mut self) {
        // バッチをフロントエンドに送信
        emit_audio_metrics_batch(&self.current_batch);
        self.current_batch.clear();
    }
}
```

**効果**: イベント送信オーバーヘッドを削減

### 3. パフォーマンスログ

```rust
#[cfg(debug_assertions)]
macro_rules! perf_debug {
    ($($arg:tt)*) => { log::debug!($($arg)*) };
}

#[cfg(not(debug_assertions))]
macro_rules! perf_debug {
    ($($arg:tt)*) => {};  // リリースビルドではゼロコスト
}
```

**使用例**:
```rust
perf_debug!("Buffer size: mic={}, system={}", mic_buffer.len(), system_buffer.len());
```

## 音声品質設定 / Audio Quality Settings

### サンプルレート選択

| サンプルレート | 用途 | 品質 |
|---------------|------|------|
| 16000 Hz | 電話品質、省リソース | 低 |
| 44100 Hz | CD品質 | 中 |
| 48000 Hz | プロフェッショナル (推奨) | 高 |

### Whisperモデル選択

| モデル | サイズ | 精度 | 速度 |
|--------|--------|------|------|
| tiny | 75 MB | 低 | 最速 |
| base | 142 MB | 中 | 高速 |
| small | 466 MB | 中-高 | 中 |
| medium | 1.5 GB | 高 | 遅 |
| large-v3 | 2.9 GB | 最高 | 最遅 |

**推奨設定**:
- **開発**: `base` または `small`
- **本番**: `medium` または `large-v3` (GPUあり)

## トラブルシューティング / Troubleshooting

### 問題: 音声が途切れる

**原因**:
- バッファサイズが小さすぎる
- CPU負荷が高すぎる

**解決策**:
```rust
// バッファサイズを増やす
const BUFFER_SIZE: usize = 4800;  // 100ms @ 48kHz
```

### 問題: システム音声がキャプチャできない

**macOS**:
1. システム環境設定 → セキュリティとプライバシー → 画面録画
2. Meetilyを許可
3. BlackHole 2chをインストール

**Windows**:
1. WASAPIドライバを確認
2. サウンド設定でステレオミックスを有効化

### 問題: Whisperが遅い

**解決策**:
1. GPU加速を有効化:
   ```bash
   # macOS (自動)
   cargo build --release
   
   # Windows (NVIDIA)
   cargo build --release --features cuda
   
   # Windows/Linux (AMD/Intel)
   cargo build --release --features vulkan
   ```

2. より小さいモデルを使用: `medium` → `small` → `base`

3. VAD閾値を上げる (無音を多めにフィルタ):
   ```rust
   energy_threshold: 0.03,  // デフォルト: 0.02
   ```

## デバッグ / Debugging

### 音声ログ有効化

```bash
# macOS
RUST_LOG=app_lib::audio=debug ./clean_run.sh

# Windows
$env:RUST_LOG="app_lib::audio=debug"
./clean_run_windows.bat
```

### 音声メトリクス監視

Developer Console (Cmd+Shift+I) でリアルタイム監視:
- Buffer sizes (mic/system)
- Mixing window count
- VAD detection rate
- Dropped chunks

## 参考リンク / References

- [audio/pipeline.rs](../../../frontend/src-tauri/src/audio/pipeline.rs) - パイプライン実装
- [audio/recording_manager.rs](../../../frontend/src-tauri/src/audio/recording_manager.rs) - 録音管理
- [whisper_engine/whisper_engine.rs](../../../frontend/src-tauri/src/whisper_engine/whisper_engine.rs) - Whisper統合
- [AUDIO_MODULARIZATION_PLAN.md](../../../docs/AUDIO_MODULARIZATION_PLAN.md) - モジュール化計画

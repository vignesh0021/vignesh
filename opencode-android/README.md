# OmniCode

> One app, every AI coding model. (Internal package/module names retain the original
> `opencode` identifiers; only the user-facing brand is **OmniCode**.)

An Android application that mirrors the core workflow of [opencode.ai](https://opencode.ai) —
the open-source, provider-agnostic AI coding agent — reimagined for a phone. It is built
with **Kotlin + Jetpack Compose**, follows an **MVVM + repository** architecture, and ships
with a complete **GitHub Actions CI/CD pipeline** that builds, tests, and produces signed
release artifacts with no manual steps.

<p align="center"><em>&gt;_ pair-program with an AI coding agent, from anywhere.</em></p>

---

## Feature parity with opencode.ai

| opencode.ai capability | OpenCode Mobile implementation |
| --- | --- |
| AI coding chat with streaming responses | Real-time token streaming over SSE (`ChatScreen`) |
| **Free models out of the box** | Defaults to **OpenRouter** free models; **Groq** free tier also built in |
| Pluggable model providers | OpenRouter, Groq, Anthropic, OpenAI + any OpenAI-compatible endpoint, switchable at runtime |
| Model selection | In-app model picker seeded from a catalog (free models flagged) |
| System-prompt presets | Selectable presets adapted from open-source coding-agent prompts |
| Multiple sessions / history | Persistent sessions & message history via Room (`SessionsScreen`) |
| Project / workspace files | Sandboxed on-device workspace with a file browser (`FilesScreen`) |
| Code viewing & editing | Syntax-highlighted viewer + in-place editor (`CodeViewerScreen`) |
| Markdown + fenced code rendering | Custom markdown block parser with per-language highlighting & copy-to-clipboard |
| Configurable system prompt | Editable system prompt sent with every request |
| Secure credential handling | API keys encrypted at rest with AES-256 via the Android Keystore |

### Screens

- **Sessions** — create, open, rename (auto-titled from the first prompt), and delete chats.
- **Chat** — the core experience: send a prompt, watch the assistant stream its answer,
  copy any code block, and get clear inline error feedback (bad key, rate limit, offline…).
- **Files** — browse a private workspace, create files/folders, and open files.
- **Code viewer** — read code with syntax highlighting or flip into edit mode and save.
- **Settings** — pick a provider & model, paste an API key, set the base URL and system prompt.

---

## Architecture

```
app/
├── domain/model        # Provider, Session, ChatMessage, ModelCatalog (pure Kotlin)
├── data/
│   ├── local           # Room entities, DAOs, database, mappers
│   ├── remote          # ChatClient abstraction, Anthropic & OpenAI SSE clients, DTOs
│   ├── settings        # DataStore preferences + encrypted ApiKeyStore
│   └── repository      # Session / Chat / Workspace repositories
├── di                  # AppContainer — lightweight manual DI (no annotation processors)
├── ui/
│   ├── theme           # Compose Material 3 theme (terminal-inspired dark palette)
│   ├── navigation      # Navigation-Compose graph
│   ├── sessions | chat | files | settings   # feature packages (Screen + ViewModel)
└── util                # Logger, SyntaxHighlighter, MarkdownBlocks (unit-tested)
```

**Design choices**

- **Streaming, provider-agnostic client.** `ChatClient` is an interface; `AnthropicChatClient`
  and `OpenAiChatClient` implement it over OkHttp SSE. Adding a provider is one class.
- **Single source of truth.** The UI observes the Room message table via `Flow`, so streamed
  tokens render live while remaining durable across process death.
- **Manual DI.** A tiny `AppContainer` wires the graph — deliberately avoiding kapt/KSP DI
  frameworks to keep CI builds fast and free of codegen version pitfalls.
- **Security first.** Keys never touch plaintext storage; they are AES-256 encrypted through
  the Android Keystore and excluded from cloud backup / device transfer.

---

## Tech stack

- Kotlin 2.0, Coroutines & Flow
- Jetpack Compose (Material 3), Navigation-Compose
- Room (KSP), DataStore Preferences, Security-Crypto
- OkHttp + okhttp-sse, kotlinx.serialization
- JUnit4, MockK, coroutines-test — Gradle version catalog (`gradle/libs.versions.toml`)

---

## Build & run locally

Requirements: JDK 17, Android SDK (API 35).

```bash
cd opencode-android
./gradlew assembleDebug            # build a debug APK
./gradlew testDebugUnitTest        # run JVM unit tests
./gradlew lintDebug                # run Android Lint
```

The debug APK lands in `app/build/outputs/apk/debug/`. Install it, open **Settings**, pick a
provider, paste an API key, and start a chat.

---

## CI/CD — GitHub Actions

Workflow: [`.github/workflows/opencode-android.yml`](../.github/workflows/opencode-android.yml)

**`build-and-test`** (every push & PR that touches `opencode-android/**`)
1. JDK 17 + Gradle setup with build caching
2. `lintDebug` → `testDebugUnitTest` → `assembleDebug`
3. Uploads the **debug APK**, **lint report**, and **unit-test report** as artifacts

**`release`** (manual `workflow_dispatch`, or a push to `main`)
1. Decodes the signing keystore from a secret (falls back to debug signing if none is set,
   so the pipeline never breaks on forks)
2. Builds a **signed release AAB + APK** with R8 minification & resource shrinking
3. Uploads both as downloadable artifacts, versioned by the workflow run number

### Configuring signing secrets

Signing material is passed entirely through environment variables / secrets — nothing
sensitive is committed. Create a keystore once, then add these repository secrets:

```bash
keytool -genkeypair -v -keystore release.keystore -alias opencode \
  -keyalg RSA -keysize 2048 -validity 10000
base64 -w0 release.keystore    # value for ANDROID_KEYSTORE_BASE64
```

| Secret | Purpose |
| --- | --- |
| `ANDROID_KEYSTORE_BASE64` | Base64 of the `.keystore` file |
| `ANDROID_KEYSTORE_PASSWORD` | Keystore password |
| `ANDROID_KEY_ALIAS` | Key alias (e.g. `opencode`) |
| `ANDROID_KEY_PASSWORD` | Key password |

The Gradle build reads them as `OPENCODE_KEYSTORE_FILE`, `OPENCODE_KEYSTORE_PASSWORD`,
`OPENCODE_KEY_ALIAS`, `OPENCODE_KEY_PASSWORD` (see `app/build.gradle.kts`). Locally you can
instead create a git-ignored `keystore.properties` with `storeFile/storePassword/keyAlias/keyPassword`.

### Deploying

- **Manual trigger:** Actions → *OpenCode Mobile CI/CD* → *Run workflow* → download the
  `opencode-release-aab` artifact and upload it to the Google Play Console.
- **Internal distribution:** grab the `opencode-debug-apk` artifact from any CI run.

---

## Free models

The app defaults to a **free** provider/model so it works at no cost. Two free backends are
built in:

- **OpenRouter** (`https://openrouter.ai/api`) — many genuinely free models (DeepSeek R1/V3,
  Qwen2.5 Coder, Llama 3.3, Gemini 2.0 Flash, Mistral Small). Get a free key at
  <https://openrouter.ai/keys>.
- **Groq** (`https://api.groq.com/openai`) — fast free tier (Llama 3.3 70B, Llama 3.1 8B,
  DeepSeek R1 Distill). Get a free key at <https://console.groq.com/keys>.

Free models still require a **free API key** from the provider (paste it once in Settings). No
key is ever baked into the app or the build. Anthropic and OpenAI remain available for users
who prefer them. Because these providers are OpenAI-compatible, adding another is a one-line
catalog entry. This is the same free-model pool opencode.ai users tap into (OpenRouter's
`:free` models).

**Any model / any gateway.** Settings has a **custom model id** field and a **base URL** field,
so you can point OmniCode at any OpenAI-compatible endpoint and run any model the provider
exposes — not just the ones in the catalog.

> Robustness: the OpenAI-compatible client reads the stream by hand and falls back to parsing
> a plain-JSON body, so free gateways that answer HTTP 200 with a non-SSE body (or an inline
> `{"error":…}`) surface their real message instead of a confusing "Request failed (HTTP 200)".

> On-device / "our own" model: bundling a local LLM (e.g. a small Gemma via MediaPipe LLM
> Inference or llama.cpp) is possible but ships tens/hundreds of MB of weights and native
> libraries; the free hosted models above deliver the zero-cost experience without that
> footprint. Open an issue if you want the on-device path wired in.

## System-prompt presets

Settings offers selectable prompt presets — **OpenCode (default)**, **Codex-style agent**,
**Conventions-first**, **Plan then code**, and **Code reviewer** — plus a free-text editor for
the active prompt. The presets are adapted and condensed for a mobile chat client from the
publicly collected open-source agent prompts in
[x1xhlol/system-prompts-and-models-of-ai-tools](https://github.com/x1xhlol/system-prompts-and-models-of-ai-tools)
(the open-source CLI agents: Codex CLI, Gemini CLI, Cline).

## Runtime configuration

No API keys are baked into the app or the build. Each user supplies their own key at runtime
in **Settings**; it is stored encrypted on-device and sent only to the provider they select.

## License

Provided as a reference implementation for educational use.

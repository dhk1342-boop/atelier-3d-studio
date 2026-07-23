# 아틀리에 3D 스튜디오

Shapr3D식 카메라 조작과 어반베이스식 공간 연출을 참고한 브라우저 기반 3D 인테리어 프로토타입입니다.

## 포함된 기능

- 원근/직교 시점을 오갈 수 있는 3D 공간 편집기
- 재사용 가능한 기본 가구 카탈로그
- 이동, 회전, 크기 조절 기즈모
- 방 크기, 마감, 채광 조절
- 선택한 항목의 수치 편집 패널
- 로컬 자동저장과 JSON 백업 내보내기
- 공유 링크 복사
- Supabase 연결 시 클라우드 저장과 여러 기기 동기화
- 평면 보기에서 벽을 한 구간씩 그리는 기능

## 빠른 실행

매번 터미널 명령을 입력하고 싶지 않다면 아래 파일을 더블클릭하면 됩니다.

- `outputs/아틀리에 3D 실행.command`
- `outputs/stop-atelier.command`

시작 스크립트는 로컬 사이트를 실행한 뒤 브라우저를 자동으로 엽니다.
기본 주소는 `http://localhost:4174/` 입니다.

## 저장

- `로컬 저장`은 현재 장면을 이 브라우저에 저장합니다.
- 작업 중 대부분의 수정은 자동 저장됩니다.
- `공유 링크 복사`는 현재 장면 링크를 만듭니다.
- Supabase가 연결되어 있고 `프로젝트 코드`가 있으면 공유 링크는 짧은 프로젝트 링크로 바뀝니다.
- `클라우드 저장`과 `자동저장 켜기`를 쓰면 다른 기기에서도 같은 프로젝트 코드를 열어 이어서 작업할 수 있습니다.
- `JSON 내보내기`는 현재 장면의 백업 파일을 내려받습니다.
- 브라우저 저장소를 지우면 로컬 저장이 사라질 수 있으므로, 백업은 `JSON 내보내기`가 더 안전합니다.

## GitHub 올리기

이 폴더에서 한 번만 아래 순서로 진행하면 됩니다.

```bash
git init -b main
git add .
git commit -m "Initial commit"
```

그다음 GitHub에서 빈 저장소를 하나 만든 뒤 아래처럼 연결합니다.

```bash
git remote add origin https://github.com/<계정명>/<저장소이름>.git
git push -u origin main
```

`gh` CLI가 설치되어 있지 않아도 위 방식으로 올릴 수 있습니다.

## Supabase 연결

1. Supabase에서 새 프로젝트를 만듭니다.
2. SQL Editor에서 `supabase-schema.sql` 내용을 실행합니다.
3. `.env.example`을 복사해 `.env` 파일을 만들고 값을 채웁니다.

```bash
cp .env.example .env
```

`.env` 안에는 아래 값이 들어갑니다.

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`
- `VITE_SUPABASE_TABLE`

설정을 넣고 앱을 다시 실행하면 `프로젝트 코드`, `클라우드 저장`, `자동저장 켜기`, `공유 링크 복사`가 함께 동작합니다.

## 로컬 실행

내장된 Node 경로를 쓰거나, 직접 설치한 Node를 `PATH`에 추가해 실행할 수 있습니다.

```bash
env PATH="/Users/kimdohyeon/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:$PATH" \
  ./node_modules/.bin/vite
```

그다음 Vite가 보여 주는 로컬 주소를 열면 됩니다.

## 빌드

```bash
env PATH="/Users/kimdohyeon/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:$PATH" \
  ./node_modules/.bin/vite build
```

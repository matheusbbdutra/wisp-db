package main

// AppVersion segue o mesmo texto das tags git (ex. "v0.1.0-beta.3") —
// atualizar manualmente a cada release, mesmo padrão não automatizado do
// VERSION em packaging/deb/build.sh (sem infra de ldflags/build-time nesta
// fase). Usado pelo verificador de atualização (CheckForUpdate, app.go).
const AppVersion = "v0.1.0-beta.4"

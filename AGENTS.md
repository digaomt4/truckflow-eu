# TruckFlow EU — Regras do Projeto

## Sincronização obrigatória com o GitHub

Sempre que concluir alterações neste projeto, atualize também o repositório no GitHub (`origin`, branch `main`):

1. **Verifique antes de commitar**: execute `git status --short` e garanta que arquivos sensíveis ou gerados (`.env`, `.env.local`, `node_modules/`, `dist/`, `.firebase/`) **nunca** sejam adicionados ao commit.
2. **Valide alterações de código**: quando houver mudanças no código da aplicação, execute os testes (`npm.cmd test`) e o build (`npm.cmd run build`) antes de fazer commit e push.
3. **Commit e push**: faça stage apenas dos arquivos intencionais, crie um commit com mensagem clara e descritiva e envie com `git push origin main`.
4. **Confirmação**: informe na resposta ao usuário o hash do commit enviado e confirme que o repositório ficou limpo.

## Ambiente Windows e Ferramentas Locais

- Se `node`, `npm`, `git` ou `gh` não estiverem no `PATH` da sessão do terminal, adicione ou chame diretamente os binários portáteis em:
  - `$env:LOCALAPPDATA\Programs\nodejs`
  - `$env:LOCALAPPDATA\Programs\mingit\cmd`
  - `$env:LOCALAPPDATA\Programs\gh\bin`
- No PowerShell, prefira `npm.cmd`, `npx.cmd`, `git.exe` e `gh.exe` para evitar bloqueios de `ExecutionPolicy` nos wrappers `.ps1`.

## Cuidados do Projeto

- **Segredos**: nunca commitar `.env`, credenciais ou chaves privadas.
- **Firebase Storage**: o projeto Firebase (`truckflow-eu-2026`) não tem bucket Storage provisionado por padrão; não adicione bloco `"storage"` em `firebase.json` sem provisionar o Storage antes.
- **Compatibilidade**: preserve regras de negócio, fórmulas financeiras (`src/utils/salaryCalculator.js`) e compatibilidade com os dados existentes no Firestore.
- **Idioma**: responda ao usuário em português.

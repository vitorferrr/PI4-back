# PI4-back

## Integração com Supabase Storage (INT-06)

Configuração, API, limites de PNG/HTTP, integração com BE-23 e INT-04,
compensação, testes e resultados de desempenho estão em [docs/INT-06.md](docs/INT-06.md).

Requer Node.js >=22 e bucket privado `documentos`. As variáveis
`SUPABASE_URL`, `SUPABASE_SECRET_KEY` e `SUPABASE_STORAGE_BUCKET` devem ser
configuradas exclusivamente no servidor, conforme a documentação.

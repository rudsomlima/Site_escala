# Escala de Acompanhamento

App de escala semanal (segunda a domingo) para revezamento de acompanhamento hospitalar.

## Funciona assim

- Cada dia mostra Manhã / Tarde / Noite.
- Os horários **não cobertos** aparecem como botões amarelos (ex: "+ 14:00–18:00").
- Toque no botão do horário → toque no nome → pronto, 2 toques para preencher uma vaga.
- "📋 Copiar p/ WhatsApp" gera o texto formatado pronto pra colar no grupo.
- Setas `‹ ›` no topo navegam entre semanas (o histórico de todas as semanas fica salvo).

## Rodar localmente

```bash
npm install
npm run dev
```

Sem configurar nada, os dados ficam salvos num arquivo local (`.data/weeks.json`) só para
desenvolvimento — isso **não funciona em produção na Vercel** (sistema de arquivos é temporário lá).

## Deploy na Vercel com dados permanentes

Não precisa de banco de dados — os dados continuam em um único arquivo JSON, só que
guardado no **Vercel Blob** (armazenamento de arquivos da própria Vercel) em vez do disco
local, que é temporário em produção.

1. Suba este projeto num repositório Git e importe na Vercel (vercel.com/new).
2. No painel do projeto na Vercel, vá em **Storage → Create → Blob** e conecte ao projeto.
3. A Vercel cria automaticamente a variável de ambiente `BLOB_READ_WRITE_TOKEN`.
4. Faça um novo deploy (ou redeploy) — a partir daí o arquivo `escala/weeks.json` fica salvo
   permanentemente no Blob da Vercel.

Sem o passo 2, o site funciona mas perde os dados a cada novo deploy/cold start.
Se em algum momento você quiser usar Redis/KV em vez de Blob, basta criar uma KV/Upstash em
**Storage** e conectar — o código já dá prioridade a `KV_REST_API_URL`/`KV_REST_API_TOKEN`
quando essas variáveis existem.

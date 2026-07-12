# Como publicar o Golden SaaS num link da internet (passo a passo)

Antes de começar: tentei publicar isso automaticamente para você, mas descobri duas coisas:

1. O ambiente de nuvem onde eu trabalho está bloqueado para acessar plataformas de hospedagem (Render, Railway, Vercel, Fly.io — todas recusaram acesso).
2. A ponte com o seu computador (que me deixaria clicar pelo seu navegador) não está ativa nesta sessão.

Então, por enquanto, você vai precisar seguir estes passos você mesmo — são simples, sem precisar escrever nenhuma linha de código. Se a qualquer momento quiser tentar de novo comigo "dirigindo" pelo seu navegador, é só reabrir o app Claude Desktop e me avisar aqui que eu tento de novo.

Vamos usar dois serviços gratuitos e conhecidos: **GitHub** (para guardar o código) e **Render** (para colocá-lo no ar).

---

## Parte 1 — Colocar o código no GitHub

1. Acesse **https://github.com** e crie uma conta gratuita (se ainda não tiver).
2. Clique no botão verde **"New"** (ou o ícone **+** no canto superior direito → **New repository**).
3. Em "Repository name", digite `golden-saas`. Deixe marcado como **Public**. Clique em **Create repository**.
4. Na página do repositório vazio, clique no link **"uploading an existing file"**.
5. Descompacte o arquivo `golden-saas-mvp.zip` que te enviei (clique com o botão direito → Extrair/Descompactar) e arraste **a pasta `golden-saas` inteira** (com tudo dentro: `src`, `server.js`, `package.json`, etc.) para a área de upload do GitHub. O navegador consegue enviar pastas inteiras arrastando.
6. Role até o final da página, escreva algo como "Primeira versão" na caixa de mensagem, e clique em **Commit changes**.

Pronto — seu código já está no GitHub.

---

## Parte 2 — Publicar no Render (hospedagem gratuita)

1. Acesse **https://render.com** e clique em **Get Started** para criar uma conta gratuita. Você pode entrar direto com sua conta do GitHub (mais rápido).
2. No painel (dashboard), clique em **New +** → **Web Service**.
3. Conecte sua conta do GitHub quando for solicitado, e selecione o repositório **golden-saas**.
4. Preencha as configurações assim:
   - **Name:** `golden-saas` (ou o nome que preferir)
   - **Region:** a mais próxima de você
   - **Branch:** `main`
   - **Build Command:** `npm install`
   - **Start Command:** `node server.js`
   - **Instance Type:** **Free**
5. Clique em **Deploy Web Service**.
6. Aguarde alguns minutos enquanto aparecem os logs de build. Quando o status mudar para **"Live"**, você verá um link no topo da página, parecido com:
   `https://golden-saas.onrender.com`

Esse é o seu link público! Pode abrir em qualquer navegador, celular ou computador.

Login de acesso (o mesmo de sempre):
- **E-mail:** admin@goldensaas.com
- **Senha:** golden123

---

## ⚠️ Aviso importante sobre os dados no plano gratuito

O plano gratuito do Render **não guarda os dados de forma permanente**. Ele "dorme" depois de 15 minutos sem uso e, quando ele acorda de novo, o banco de dados volta ao ponto inicial (com os dados de exemplo). Ou seja: **esse link é ótimo para testar e mostrar o sistema para outras pessoas, mas não deve ser usado ainda para cadastrar clientes e ordens de serviço reais** — eles seriam apagados no próximo "sono" do servidor.

Quando você validar que o sistema está do jeito que quer, siga a Parte 3 abaixo pra deixar os dados salvos de verdade, pra sempre.

---

## Parte 3 — Deixar o sistema no ar de verdade, sem apagar os dados (plano pago + disco persistente)

Isso resolve o problema do plano gratuito: o sistema fica **sempre ligado** (sem "dormir") e os dados (banco de dados, fotos, vídeos) ficam salvos permanentemente, sobrevivendo a reinicializações e a novos envios de código.

**Custo:** plano Starter do Render (US$ 7/mês) + disco persistente (US$ 0,25 por GB/mês — 5 GB fica em torno de US$ 1,25/mês). Total aproximado: **~US$ 8,25/mês**. É cobrado direto no cartão cadastrado na sua conta Render.

### Passo 1 — Subir o código atualizado no GitHub
Este pacote já vem com uma pequena mudança no código que permite indicar onde salvar os dados (variável `DATA_DIR`). Suba os arquivos atualizados no seu repositório `golden-saas` no GitHub (arraste e substitua os arquivos, igual você fez na primeira vez — o GitHub avisa que vai sobrescrever, é isso mesmo que você quer).

### Passo 2 — Trocar o plano do serviço no Render
1. No painel do Render, entre no seu serviço `golden-saas`.
2. Vá em **Settings** (Configurações) → procure a seção do tipo de instância (**Instance Type**).
3. Troque de **Free** para **Starter** (US$ 7/mês) e salve.

### Passo 3 — Adicionar o disco persistente
1. Ainda em **Settings** do serviço, procure a seção **Disks**.
2. Clique em **Add Disk**.
3. Preencha:
   - **Name:** `golden-saas-data` (ou o nome que preferir)
   - **Mount Path:** `/var/data`
   - **Size:** `5 GB`
4. Salve. O Render vai pedir pra reiniciar o serviço pra aplicar — pode confirmar.

### Passo 4 — Configurar a variável de ambiente DATA_DIR
1. Vá em **Environment** (no menu do serviço) → **Add Environment Variable**.
2. Adicione:

| Variável | Valor |
|---|---|
| `DATA_DIR` | `/var/data` |

3. Clique em **Save Changes**. O Render vai fazer um novo deploy automaticamente.

### Passo 5 — Conferir
Depois que o status voltar para **"Live"**, entre no sistema e cadastre algo de teste (um cliente, por exemplo). Espere uns minutos e recarregue a página — o dado precisa continuar lá. A partir de agora, os dados não somem mais sozinhos.

**Atenção:** qualquer cliente, veículo, O.S., peça etc. que você tinha cadastrado *antes* desse passo (no plano gratuito) não é migrado automaticamente — o disco persistente começa vazio (com o usuário admin e a "Loja Principal" padrão criados de novo). Cadastre os dados reais só depois de confirmar que o disco persistente está funcionando.

---

## Precisa de ajuda em algum passo?

Me diga em qual etapa travou (pode até mandar um print da tela) que eu te explico exatamente o que clicar.

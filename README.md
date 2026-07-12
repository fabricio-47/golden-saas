# Golden SaaS — MVP do módulo Oficina Inteligente

Módulo de **Oficina Inteligente / Ordens de Serviço** do Golden SaaS: cadastro de clientes, cadastro de bicicletas e motos elétricas (com dados técnicos de motor, controladora e bateria), checklist de entrada especializado, fotos/vídeos, orçamento → execução → conclusão, valores separados por peça/mão de obra, formas de pagamento e envio automático de e-mail para o cliente.

Roda sem complicação: **não precisa instalar nada além do Node.js**. Não há passo de `npm install` obrigatório — o sistema usa apenas recursos nativos do Node (incluindo banco de dados SQLite embutido), então funciona assim que você tiver o Node instalado.

Este projeto já está publicado em: **https://golden-saas.onrender.com**

---

## 1. O que já funciona nesta versão

- **Login** com usuário e senha.
- **Clientes**: cadastrar, listar, editar, ver detalhes, excluir.
- **Veículos (bicicleta ou moto elétrica)**: cadastro vinculado a um cliente, com número de série do motor, da controladora e da bateria, saúde da bateria (SOH %), ciclos de carga e quilometragem estimada.
  - Para **motos elétricas**, é **obrigatório** anexar foto do chassi e foto do número de série da bateria no cadastro.
- **Ordens de Serviço**:
  - Problema relatado pelo cliente (registrado antes do diagnóstico).
  - Checklist de entrada especializado (quadro, motor, fiação, display, bateria, freios, pneus, transmissão).
  - Diagnóstico técnico e serviços realizados.
  - Fotos da checagem de entrada e fotos/vídeos dos serviços realizados (upload direto pelo celular ou computador).
  - Valores separados em **peças** e **mão de obra**, com total calculado automaticamente.
  - Forma de pagamento: Pix, dinheiro, cartão de débito ou cartão de crédito (com número de parcelas).
  - Fluxo de status: **Orçamento → Execução → Concluída**.
  - Botão **"Enviar por e-mail"**: manda um resumo completo da O.S. para o e-mail do cliente.
  - Botão **"Finalizar e avisar cliente"**: marca a O.S. como concluída e avisa automaticamente o cliente por e-mail que o serviço está pronto.
- **Estoque de peças**: cadastro de peças com categoria, número de série (opcional), quantidade, estoque mínimo, custo unitário e preço de venda.
  - Direto na tela da Ordem de Serviço, dá pra vincular peças do estoque usadas naquele serviço — a quantidade é descontada do estoque automaticamente, e o "Valor de peças" da O.S. é recalculado sozinho.
  - Se remover uma peça vinculada de uma O.S., a quantidade volta pro estoque automaticamente.
  - Alerta automático no Dashboard quando uma peça está com estoque igual ou abaixo do mínimo definido.
- **Dashboard**: contadores de O.S. por status, alerta automático de veículos com saúde de bateria abaixo de 90% e alerta de peças em estoque baixo.
- **Usuários e níveis de acesso**: 4 níveis — **Direção**, **Gerência**, **Vendedor** e **Mecânico**. Direção e Gerência podem cadastrar/editar/desativar usuários (menu **Usuários**) e ver o log de auditoria de login (menu **Auditoria**); Vendedor e Mecânico têm acesso operacional completo (clientes, veículos, O.S., estoque) mas não veem esses dois menus.
  - Usuário nunca é excluído de verdade, só **desativado** (fica registrado no histórico, mas não consegue mais entrar).
  - Não é possível desativar o próprio usuário nem o último usuário de Direção ativo, pra evitar ficar sem acesso ao sistema.
- **Auditoria de login**: toda tentativa de entrar no sistema (com sucesso ou falha) fica registrada com data/hora, e-mail usado e IP.
- **Ordens de Serviço nunca são excluídas**, só **desativadas** — o botão "Excluir" virou "Desativar O.S."; o histórico completo continua salvo e pode ser reativado a qualquer momento pela própria tela da O.S. ou pelo filtro "Ver desativadas" na listagem.
- **Número da versão** do sistema aparece sempre no rodapé do menu lateral e na tela de login.

## 2. Configurar o envio de e-mails (obrigatório para os botões de e-mail funcionarem)

O envio de e-mail não vem configurado por padrão — sem isso, os botões de e-mail mostram um erro explicando o que falta.

**Importante:** o sistema envia e-mail através da **API da Brevo** (serviço gratuito de envio de e-mail), e não por SMTP direto. Isso é necessário porque o Render, no plano gratuito, **bloqueia conexões SMTP de saída** (portas 25/465/587) desde setembro de 2025, para evitar abuso de spam — então SMTP tradicional simplesmente não funciona em planos gratuitos de hospedagem. A API da Brevo usa a porta 443 (a mesma do site normal), que nunca é bloqueada.

### Passo 1 — Criar conta gratuita na Brevo
1. Acesse **app.brevo.com** e crie uma conta gratuita (não pede cartão de crédito).
2. O plano gratuito permite **300 e-mails por dia**, mais que suficiente para uma oficina.

### Passo 2 — Validar o e-mail remetente
1. Dentro da Brevo, vá em **Configurações (engrenagem) → Remetentes e IP → Remetentes**.
2. Adicione o e-mail que vai aparecer como remetente das mensagens (ex: seu e-mail da oficina).
3. A Brevo manda um código (OTP) para esse e-mail — confirme o código. Não precisa mexer em DNS nem no domínio do site.

### Passo 3 — Gerar a chave de API
1. Vá em **Configurações → SMTP e API → Chaves de API**.
2. Clique em **Gerar uma nova chave de API**, dê um nome como "Golden SaaS".
3. Copie a chave gerada (só aparece uma vez).

### Passo 4 — Configurar no Render
No painel do Render (**seu serviço → Environment → Add Environment Variable**), adicione:

| Variável | Exemplo | Observação |
|---|---|---|
| `BREVO_API_KEY` | `xkeysib-xxxxxxxx...` | Chave gerada no Passo 3 |
| `EMAIL_FROM` | `suaoficina@gmail.com` | Precisa ser o e-mail validado no Passo 2 |
| `EMAIL_FROM_NAME` | `Golden SaaS` | (opcional) nome que aparece como remetente |

Depois de adicionar as variáveis, clique em **Save, rebuild, and deploy** para aplicar. Se algo der errado no envio, o motivo completo aparece na aba **Logs** do Render (procure por linhas com `[email]`).

## 3. Aviso sobre armazenamento no plano gratuito

O plano gratuito do Render **não guarda dados permanentemente**: ele "dorme" após 15 minutos sem uso e, ao acordar, o banco de dados e os arquivos enviados (fotos/vídeos) voltam ao ponto inicial. Ou seja, esse ambiente é ótimo para testar e mostrar o sistema, mas **ainda não deve ser usado para cadastrar clientes e ordens de serviço reais**. Quando quiser migrar para uso real, é preciso um plano pago com disco persistente (ou um banco de dados/armazenamento externo) — posso te ajudar nisso quando chegar a hora.

## 4. O que ainda NÃO está nesta versão (próximos passos combinados no roteiro)

- **Agenda de atendimentos** (cliente marcar horário, visão de agenda do dia/semana).
- **Financeiro / fluxo de caixa** (resumo de entradas por período e forma de pagamento).
- Módulo de **Vendas / CRM** (contratos de manutenção, cobrança recorrente, notas fiscais).
- Envio automático de alertas por **WhatsApp**.
- Orçamento/O.S. em **PDF** para imprimir ou enviar.
- Suporte a múltiplas oficinas (multi-tenant) — hoje é uma oficina só, mas já com múltiplos usuários e níveis de permissão.
- Anexar as fotos/vídeos diretamente dentro do e-mail (hoje o e-mail traz o texto completo, mas as fotos ficam só dentro do sistema).
- Movimentações de estoque com histórico (hoje a quantidade só é ajustada direto; um "log" de entradas/saídas pode ser adicionado depois).

## 5. Como rodar no seu computador (opcional, além do link publicado)

### Passo 1 — Instalar o Node.js
1. Acesse https://nodejs.org e baixe a versão **22.5 ou mais recente** (se o site só oferecer uma mais antiga, use https://nodejs.org/en/download/current).
2. Instale normalmente.
3. Confira com `node -v` no Terminal/Prompt de Comando — deve mostrar `v22.x.x` ou mais.

### Passo 2 — Rodar
Descompacte o projeto, abra o Terminal/Prompt de Comando na pasta e rode:
```
node server.js
```
Acesse http://localhost:3000 no navegador.

Login: **admin@goldensaas.com** / senha: **golden123** (nível Direção — cadastre os demais usuários da equipe pelo menu "Usuários" depois de entrar).

### Onde ficam os dados salvos localmente?
Em `data/golden-saas.db` (banco) e `data/uploads/` (fotos e vídeos). Para zerar tudo, apague esses arquivos/pastas e rode `node server.js` de novo.

## 6. Por que este projeto não usa React/Next.js/frameworks?

Foi construído num ambiente sem acesso à internet para baixar pacotes, então tudo usa apenas recursos nativos do Node.js (incluindo um parser de upload de arquivos e um cliente de e-mail escritos do zero). Na prática isso significa: sem `npm install`, sem dependências para quebrar — só Node.js e pronto.

## 7. Próximos passos sugeridos

1. Configurar o e-mail (seção 2) para os botões de e-mail funcionarem de verdade.
2. Testar o cadastro de motos elétricas e o upload de fotos/vídeos.
3. Construir o módulo de **Estoque**.
4. Construir o módulo de **Vendas / CRM**.
5. Migrar para um plano com armazenamento permanente quando for usar com clientes reais.

---

Qualquer dúvida, me chame — posso te guiar passo a passo ou ajustar o que for preciso.

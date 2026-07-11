# Golden SaaS — MVP do módulo Oficina Inteligente

Este é o primeiro pedaço funcional do Golden SaaS: o módulo de **Oficina Inteligente / Ordens de Serviço**, com cadastro de clientes, cadastro de bicicletas elétricas (com dados técnicos de motor, controladora e bateria) e o checklist de entrada especializado que é o grande diferencial do produto.

Foi construído para rodar sem complicação: **não precisa instalar nada além do Node.js**. Não há passo de `npm install` — o sistema usa apenas recursos nativos do Node (incluindo um banco de dados SQLite embutido), então funciona assim que você tiver o Node instalado.

---

## 1. O que já funciona nesta versão

- **Login** com usuário e senha.
- **Clientes**: cadastrar, listar, editar, ver detalhes, excluir.
- **Bicicletas**: cadastro vinculado a um cliente, com número de série do motor, da controladora e da bateria, saúde da bateria (SOH %), ciclos de carga e quilometragem estimada.
- **Ordens de Serviço**: abertura de O.S. vinculada a cliente + bicicleta, com o checklist de entrada especializado (inspeção de quadro, motor, fiação, display, bateria, freios, pneus, transmissão), diagnóstico técnico, serviços realizados, valor estimado e status (aberta / em andamento / concluída).
- **Dashboard**: contadores de O.S. por status e alerta automático de bicicletas com saúde de bateria abaixo de 90%.

O sistema já vem com um usuário e alguns dados de exemplo (um cliente frotista e uma O.S. em andamento) só para você visualizar como fica na prática.

## 2. O que ainda NÃO está nesta versão (próximos passos combinados no roteiro)

- Módulo de **Estoque** (rastreabilidade de peças por número de série, previsão de reposição).
- Módulo de **Vendas / CRM** (contratos de manutenção, cobrança recorrente, notas fiscais).
- Envio automático de alertas por **WhatsApp/e-mail**.
- Suporte a múltiplas oficinas (multi-tenant) e múltiplos usuários com permissões diferentes.
- Deploy em um endereço público na internet (hoje roda só no seu computador).

Ou seja: isto é uma base real e funcional do "coração" do produto — não é só uma tela bonita, os dados são salvos de verdade — mas ainda falta bastante para virar o SaaS completo do roteiro original.

## 3. Como rodar no seu computador (passo a passo)

### Passo 1 — Instalar o Node.js
Se você ainda não tem o Node.js instalado:
1. Acesse https://nodejs.org
2. Baixe a versão **LTS** mais recente (é a recomendada para a maioria das pessoas) — mas confirme que é a versão **22.5 ou mais recente** (este projeto usa um recurso de banco de dados que só existe a partir do Node 22.5). Se o site oferecer só uma versão mais antiga, baixe em https://nodejs.org/en/download/current para pegar a versão "Current".
3. Instale normalmente (Avançar, Avançar, Concluir).

Para conferir se deu certo, abra o **Terminal** (Mac/Linux) ou **Prompt de Comando/PowerShell** (Windows) e digite:
```
node -v
```
Deve aparecer algo como `v22.x.x`.

### Passo 2 — Abrir a pasta do projeto
Descompacte o arquivo `golden-saas.zip` que você recebeu em qualquer pasta do seu computador (ex: Área de Trabalho). Depois, no Terminal/Prompt de Comando, entre nessa pasta. Exemplo:
```
cd Desktop/golden-saas
```

### Passo 3 — Iniciar o sistema
Ainda no Terminal, digite:
```
node server.js
```
Você verá uma mensagem como:
```
Golden SaaS rodando em http://localhost:3000
```

### Passo 4 — Acessar no navegador
Abra o navegador (Chrome, Edge, etc.) e acesse:
```
http://localhost:3000
```

Você será redirecionado para a tela de login. Use:
- **E-mail:** admin@goldensaas.com
- **Senha:** golden123

> ⚠️ Troque essa senha antes de usar com dados reais. Por enquanto, para trocar, é preciso editar diretamente o banco de dados ou pedir para eu adicionar uma tela de "alterar senha" na próxima etapa.

Para parar o sistema, volte ao Terminal e pressione `Ctrl + C`.

### Onde ficam os dados salvos?
Tudo é salvo em um arquivo dentro da pasta `data/golden-saas.db`. Se quiser "zerar" o sistema e voltar aos dados de exemplo, basta apagar esse arquivo e iniciar o sistema de novo (`node server.js`) — ele recria tudo automaticamente.

**Importante:** faça backup desse arquivo `.db` de vez em quando (é só copiar o arquivo para outro lugar), porque é nele que ficam todos os seus clientes, bicicletas e ordens de serviço.

## 4. Por que este MVP não usa React/Next.js/banco de dados na nuvem?

O ambiente onde eu construí este projeto está sem acesso à internet para baixar pacotes (bloqueio de rede da conta/organização), então não consegui instalar frameworks como Next.js ou bibliotecas como Prisma. Para não travar o andamento, construí o sistema usando **apenas recursos nativos do Node.js** — o que, na prática, é até uma vantagem para você agora: você não precisa rodar `npm install` nem lidar com dependências quebradas, é só ter o Node.js instalado e rodar um comando.

Quando quisermos:
- Colocar isso no ar num link público (ex: para sua equipe acessar de qualquer lugar),
- Ou continuar evoluindo com um banco mais robusto (Postgres) e frameworks modernos,

isso é perfeitamente possível como próximo passo — inclusive migrando este mesmo código aos poucos, sem precisar recomeçar do zero.

## 5. Próximos passos sugeridos

1. Você testa esta versão e me diz o que ajustar (textos, campos que faltam, fluxo confuso, etc.).
2. Colocamos o sistema em um endereço público na internet (deploy), para você acessar de qualquer lugar e mostrar para outras pessoas.
3. Construímos o módulo de **Estoque**.
4. Construímos o módulo de **Vendas / CRM**.
5. Adicionamos múltiplos usuários, permissões e (se fizer sentido) suporte a mais de uma oficina no mesmo sistema.

---

Qualquer dúvida ao rodar, me chame — posso te guiar passo a passo ou ajustar o que for preciso.

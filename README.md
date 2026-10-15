# Blank PFP Studio (Next.js + MongoDB Atlas)

Editor de foto de perfil "sem foto" com **contador de visitantes únicos por IP**, **contas (usuário e senha)**,
**biblioteca de itens compartilhados (somente SVG)** e **designs salvos no banco**.

## O que tem aqui

| Parte | Onde |
|---|---|
| Página (Next.js App Router) | `app/page.js`, `app/layout.js`, `app/globals.css` |
| Cartão de visitantes | `components/VisitorCard.jsx` → `POST /api/visit` |
| Editor (canvas + painéis) | `public/studio.js` (carregado por `components/StudioShell.jsx`) e o HTML em `components/studioHtml.js` |
| API | `app/api/**/route.js` (finos) → toda a lógica em `lib/handlers.js` |
| Banco | `lib/db.js` (MongoDB Atlas) |
| Segurança de SVG | `lib/svg.js` |
| Testes | `test/` (banco falso em memória) |

### Rotas da API
`POST /api/visit` · `POST /api/auth/register|login|logout` · `GET /api/auth/me` · `POST /api/prefs` ·
`GET|POST /api/library` · `GET|DELETE /api/library/:id` · `GET /api/library/:id/file` (a antiga `/svg` continua funcionando) · `POST /api/library/:id/like` ·
`GET|POST /api/designs` · `GET|DELETE /api/designs/:id` · `GET|POST /api/profile` · `POST|DELETE /api/profile/avatar` · `GET /api/users/:id/avatar` · `POST /api/auth/password|logout-all|delete` · `PATCH /api/library/:id` (renomear)

## 1) Criar o banco no MongoDB Atlas (grátis)
1. Entre em <https://cloud.mongodb.com> e crie uma conta.
2. **Create** → cluster **M0 (Free)** → escolha a região mais próxima → **Create**.
3. **Database Access** → **Add New Database User** → defina usuário e senha (anote; evite caracteres como `@` e `:` na senha).
4. **Network Access** → **Add IP Address** → **Allow access from anywhere** (`0.0.0.0/0`). Na Vercel o IP muda, então é necessário.
5. **Database** → **Connect** → **Drivers** → copie a string `mongodb+srv://USUARIO:SENHA@cluster0.xxxxx.mongodb.net/?retryWrites=true&w=majority` e troque `USUARIO` e `SENHA`.

As coleções e os índices (`users`, `sessions`, `visitors`, `library`, `likes`, `designs`) são criados sozinhos no primeiro acesso.

## 2) Rodar no seu computador
```bash
npm install
cp .env.example .env.local   # e preencha MONGODB_URI, AUTH_SECRET e IP_SALT
npm run dev                  # http://localhost:3000
```
Quer ver a interface **sem** MongoDB? `npm run preview:fake` abre http://localhost:3100 com um banco em memória (os dados somem ao fechar).

## 3) Publicar na Vercel
1. Suba esta pasta para um repositório no GitHub.
2. Em <https://vercel.com/new> importe o repositório (Framework: Next.js, detectado sozinho).
3. Em **Environment Variables** cadastre:
   - `MONGODB_URI` — a string do Atlas
   - `MONGODB_DB` — `blankpfp` (ou outro nome)
   - `AUTH_SECRET` — texto aleatório longo (`openssl rand -hex 32`)
   - `IP_SALT` — outro texto aleatório longo
4. **Deploy**.

## Como funciona
- **Visitantes únicos:** a cada visita o site chama `POST /api/visit`. O servidor lê o IP (`x-forwarded-for`), guarda apenas um **hash** dele
  (HMAC com `IP_SALT`; o IP em si nunca é salvo) e conta cada hash uma única vez. Robôs conhecidos (Googlebot etc.) não entram.
  Pessoas na mesma rede (Wi-Fi, escola, operadora com IP compartilhado) contam como uma só.
- **Conta:** usuário (3–20 letras, números ou `_`) e senha (6–72). Senhas ficam com hash `scrypt`. A sessão é um cookie `HttpOnly` de 30 dias.
  Não há recuperação de senha (não existe e-mail na conta).
- **Biblioteca:** qualquer pessoa vê e usa os itens; só quem está logado compartilha, curte e apaga os próprios.
  Tipos: **adereços, rostos, formas, molduras e fundos** (formatos por categoria, na seção abaixo). O servidor recusa scripts, eventos (`onload=`),
  `foreignObject` e links externos. Itens SVG marcados como "pintáveis" recebem a cor escolhida no editor.
- **Designs:** em **Perfil → Designs** você salva o design atual na sua conta (até 30). O tema (modo, cor de destaque, fundo do site) e as opções de exportação também vão para a conta.
  Nada é guardado em `localStorage`.

## Perfil (botão da conta, no topo)
O botão da conta abre o modal de perfil. A engrenagem do cabeçalho saiu: **Configurações** agora ficam aqui.
| Seção | O que tem |
|---|---|
| **Conta** | foto de perfil (lápis para trocar; é recortada em 256×256 no navegador), **nome de exibição** (troca a cada **7 dias**; é diferente do usuário usado para entrar), resumo (itens, curtidas, designs, membro desde), sair |
| **Designs** | salvar o design atual, abrir e apagar |
| **Itens** | tudo que você compartilhou: usar, **renomear**, apagar; e a aba **Curtidos** |
| **Configurações** | tema, fundo do site, exportação (formato, tamanho, recorte), compartilhar o boneco (código/link/arquivo), importar |
| **Segurança** | trocar senha (encerra as outras sessões), sair de todos os dispositivos, **excluir a conta** (apaga designs e itens compartilhados) |

Sem login, o botão abre só **Conta** (entrar/criar) e **Configurações**. O nome de exibição aparece nos itens da biblioteca; mudar o nome atualiza os itens já publicados.
A foto vira `GET /api/users/:id/avatar` (bytes originais, MIME detectado, limite de 300 KB e 1024 px).

## Editor
- **Base:** *Formato* (dropdown, com o grupo "Biblioteca" para formas compartilhadas), *Cores* (silhueta/detalhe e, em formas SVG com partes, as partes ficam no mesmo bloco) e *Ajustes*.
- **Visual:** *Fundo* (cor, 2º tom, degradê), padrão, imagem de fundo, moldura e efeitos.
- **Molduras:** aplicar uma moldura da biblioteca ou enviar uma própria coloca a moldura do site em **Nenhuma**.
- **Adereços:** todas as cores (principal, secundária e detalhes do desenho) aparecem em **Cores e partes**, em linhas com nome, seletor, hexadecimal e restaurar.

## Formatos aceitos por categoria
| Categoria | Formatos | Limite |
|---|---|---|
| Adereço, Rosto, Forma | **SVG** | 100 KB |
| Moldura | **SVG** e **PNG** (com transparência) | SVG 100 KB · PNG 2 MB |
| Fundo | **PNG, JPG, WebP** e **SVG** | imagens 2 MB, até 4096×4096 px |

O servidor confere o conteúdo **real** do arquivo (assinatura PNG/JPEG/WebP, dimensões e SVG sanitizado), não a extensão nem o MIME enviado pelo navegador.
Imagens são guardadas com os bytes originais e servidas com o MIME detectado (`/api/library/:id/file`), então a transparência do PNG é preservada.

## SVG com partes personalizáveis
Se o SVG tiver partes identificadas, o editor gera um seletor de cor para cada uma (nome, cor atual, campo hexadecimal, seletor visual e botão de restaurar).

| Atributo | Efeito |
|---|---|
| `data-name` | nome exibido no editor (a parte vira personalizável) |
| `id` | identificador; elementos com o mesmo `id` viram **um** seletor só. Sem `data-name`, o `id` vira o nome |
| `data-colorable="true"` | força a parte a ser personalizável |
| `data-colorable="false"` | impede a personalização (vale também para o que estiver dentro do grupo) |

```svg
<path id="orelhas" data-name="Orelhas" data-colorable="true" fill="#ff80ab" d="..."/>
```
- Grupos (`<g data-name="Roupa">`) mudam só os elementos que não têm identificação própria; partes aninhadas ganham seu próprio seletor.
- Elementos com `fill="none"` e `stroke` têm o traço recolorido. Cores nomeadas (`red`), `rgb()` e `#abc` são entendidas.
- SVGs sem esses atributos continuam funcionando como antes. Um exemplo pronto está em `exemplos/gatinha-com-partes.svg`.
- As cores escolhidas entram no desfazer, nos designs salvos e no código de compartilhamento; o SVG original nunca é alterado.

## Celular
Abaixo de 640 px o editor usa uma composição vertical compacta: cabeçalho de uma linha, prévia pequena (botão **Ampliar** para ver maior),
abas com rolagem horizontal, área de edição que rola sozinha e rodapé (Resetar / Salvar imagem) sempre visível sem cobrir os campos.
No desktop a disposição lado a lado foi mantida.

## Testes
```bash
npm test   # 37 testes da API (contas, perfil, foto, segurança, visitantes por IP, biblioteca, SVG/PNG/JPG/WebP por categoria, designs) com banco falso
```

## Limites conhecidos
- O limite de tentativas de login/cadastro fica na memória de cada instância do servidor (serve como freio básico, não como proteção total).
- O contador por IP não distingue pessoas que dividem o mesmo IP.
- Para trocar o editor por componentes React no futuro, o ponto de partida é `components/StudioShell.jsx`.

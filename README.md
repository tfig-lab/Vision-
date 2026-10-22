# Análise de Performance de Velocidade

Painel interativo que mostra onde e quanto a velocidade dos caminhões autônomos cai por causa de interações. O efeito da pista (rampa/grade, curvatura e carga cheio × vazio) é descontado.

**Acesso:** https://tfig-lab.github.io/Vision-/ (pede usuário e senha)

## Login e segurança

O `index.html` publicado não contém os dados abertos. O painel inteiro fica criptografado com AES-256-GCM, usando uma chave aleatória. Cada usuário guarda uma cópia dessa chave, cifrada com a própria senha (PBKDF2-SHA256, 600 mil iterações).

- Sem usuário e senha válidos não há como ver o conteúdo, nem baixando o arquivo do repositório.
- Nenhuma senha fica guardada no repositório. Os nomes de usuário também não: ficam só como hash.
- Depois do login, o painel funciona normalmente, inclusive a aba **Carregar dados**, que processa novos arquivos no navegador.
- **Sair** fica ao lado de **Tela cheia**.

Os arquivos de dados (`.csv`, `.xlsx`) e os painéis abertos (`painel*.html`) estão no `.gitignore` e nunca devem ser enviados.

## Gerenciar usuários e atualizar o painel

Requer Node 18+, sem dependências. Rode na raiz do repositório e faça commit do `index.html` depois:

```bash
# novo usuário (precisa de um usuário existente para autorizar)
node scripts/proteger.js adicionar --admin admin --senha-admin "SENHA_ADMIN" --usuario joao --senha "SENHA_JOAO"

# remover usuário
node scripts/proteger.js remover --admin admin --senha-admin "SENHA_ADMIN" --usuario joao

# trocar a própria senha
node scripts/proteger.js senha --usuario joao --senha "ATUAL" --nova "NOVA"

# publicar um painel novo (mantém os usuários); com --dados cifra também as partes de dados em dados/parteN.enc
node scripts/proteger.js atualizar --admin admin --senha-admin "SENHA_ADMIN" --painel painel_enc.html --dados dados/parte0.bin,dados/parte1.bin
# painel_enc.html = painel gerado com --binario, trocando no <script id="dados"> os nomes .bin por .enc e acrescentando "cifrado":true
```

## Gerar um painel novo a partir dos dados

```bash
cd scripts && npm install xlsx@0.18.5
node gerar_painel.js --inter Interacoes_dia1.csv Interacoes_dia2.csv \
  --vel velocidade_dia1.csv velocidade_dia2.csv --depara CESG_Codigos_Caminhoes_pt_BR.xlsx
# gera painel.html (aberto, NÃO commitar) → proteja com: proteger.js atualizar ... --painel painel.html
```

Planilha de resultados em Python: `python pipeline5.py Interacoes.csv velocidade.csv saida/ de-para.xlsx`

## Arquivos

| Caminho | O que é |
|---|---|
| `index.html` | Tela de login + painel criptografado |
| `dados/parte*.enc` | Dados do painel (GPS, interações, seções), compactados e criptografados com a mesma chave |
| `scripts/proteger.js`, `scripts/login_template.html` | Criptografia, usuários e tela de login |
| `scripts/pipeline.js` | Processamento: velocidade de referência, perdas, locais, regressão |
| `scripts/template7.html` | Layout do painel |
| `scripts/gerar_painel.js` | Gera o painel no Node a partir dos arquivos (`--binario` grava os dados em `dados/parte*.bin`) |
| `scripts/codec.js` | Formato binário compacto dos dados (colunas + gzip) |
| `scripts/pipeline5.py` (+ `prep.py`, `classif.py`, `modelo.py`, `assoc.py`) | Versão em Python, gera a planilha de resultados |

## Abas

- **Trecho:** mapa por seções físicas ou células de 25 m, ranking, tabela por tipo de seção (com cada seção aberta), interações por grupo/Razao, por caminhão e hora, estatística.
- **Ciclo do caminhão:** linha do tempo de um ciclo, com velocidade real, referência, grade e interações.
- **Histórico:** matriz seção × dia (ou turno) colorida pela métrica escolhida e detalhe de uma seção ao longo do tempo: real × referência, velocidade perdida por interações, eventos por grupo e tempo na seção. As seções são montadas uma vez com todo o período, então mantêm o mesmo número em todos os dias.
- **Carregar dados:** processa novos arquivos no navegador.

Dados publicados: 15/09/2026 a 22/09/2026 (8 dias, 1,07 milhão de leituras de GPS, 25,8 mil interações no modelo).

## Critérios

- **Interação:** coluna `Razao`, exatamente como está na base.
- **Grupo:** coluna L (`Consolidação Operação`) do de-para, com `Event Code` = `Evento_Codigo`. Só as interações com grupo entram no modelo.
- **Velocidade de referência:** é a velocidade típica sem interação no mesmo local e sentido, com a mesma rampa, carga e curvatura. Vem de um modelo gradient boosting fora da amostra por caminhão. Vale 0 durante `AT is in Loading` / `AT is in Dumping`.
- **Perda:** é a queda abaixo da referência (> 3 km/h) com uma interação ativa. A janela vai de 5 s antes do início a 20 s depois do término. Quando há interações simultâneas, a perda é dividida entre elas.
- **Potencial de ganho:** velocidade atual + queda atribuída às interações, em média no tempo.
- **GPS:** cada leitura vale no máximo 20 s. Acima de 25 s sem leitura, o trecho fica marcado como "sem registro" (não é assumido 0 km/h).
- **Dia:** `Dt_Referencia`.
- **Seções físicas:** o eixo das pistas é reconstruído a partir do GPS (grade de 4 m, as duas mãos viram uma faixa, esqueleto da faixa) e cortado em retas e curvas (raio < 150 m = curva), interseções (3 ou mais trechos, raio de 35 m), frentes de carga e áreas de basculamento (eventos `AT is in Loading` / `AT is in Dumping`). Cada leitura vai para a seção mais próxima, até 30 m. Função `secoesFisicas` em `scripts/pipeline.js`.

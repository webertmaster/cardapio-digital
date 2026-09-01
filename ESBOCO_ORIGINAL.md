ESBOÇO COMPLETO — CARDÁPIO DIGITAL INTERATIVO
(documento original enviado pelo usuário no início do projeto)

1.  VISÃO GERAL DO SISTEMA

O sistema será um Cardápio Digital + Sistema de Pedidos + Painel da
Loja, com foco total em celular, PWA e atualização em tempo real.

Terá dois ambientes principais: - Cardápio do Cliente - Painel
Administrativo da Loja

O cliente acessa por um link, escolhe os produtos, informa endereço e
forma de pagamento, envia o pedido e acompanha o status. A loja recebe o
pedido em tempo real, aceita, coloca em preparo, marca como saiu para
entrega e finaliza. Tudo será salvo no Supabase.

2.  CARDÁPIO DO CLIENTE

Na tela inicial: - Logo do estabelecimento - Nome da loja - Status:
Aberto / Fechado - Horário de funcionamento - Tempo médio de entrega -
Taxa de entrega - Pedido mínimo, se existir - Campo de busca -
Categorias em rolagem horizontal

Exemplo de categorias: Promoções | Pratos do Dia | Hambúrgueres | Combos
| Porções | Bebidas | Sobremesas

3.  PRODUTOS

Cada produto terá: - Foto - Nome - Descrição - Preço - Promoção, se
houver - Disponibilidade - Botão Adicionar

Exemplo: X-Bacon Especial Pão, carne artesanal, queijo, bacon, salada e
molho da casa. R$ 24,90 Adicionar +

4.  TELA DO PRODUTO

Ao tocar em um produto: - Foto grande - Nome - Descrição - Preço -
Quantidade - Adicionais - Remoção de ingredientes - Observação

Exemplo de adicionais: - Bacon extra + R$ 4 - Queijo extra + R$ 3 -
Ovo + R$ 2 - Carne extra + R$ 8

Campo de observação: "Sem cebola e molho separado."

Botão: Adicionar ao carrinho • R$ 31,90

5.  CARRINHO

Carrinho sempre acessível na parte inferior.

Exemplo: 3 itens • R$ 68,70 — Ver pedido

Dentro do carrinho: - Produtos - Quantidades - Adicionais -
Observações - Subtotal - Taxa de entrega - Total

O cliente poderá editar ou excluir produtos antes de finalizar.

6.  IDENTIFICAÇÃO DO CLIENTE

Não será obrigatório criar conta com senha.

No primeiro pedido: - Nome - WhatsApp

Os dados poderão ser salvos no navegador usando localStorage.

Na próxima visita: "Olá, Carlos!"

Os dados aparecem preenchidos automaticamente.

7.  ENTREGA OU RETIRADA

Opções: - Entrega - Retirar no estabelecimento

Para entrega: - CEP - Rua - Número - Bairro - Complemento - Ponto de
referência

8.  ENDEREÇO SALVO

O endereço poderá ficar armazenado no dispositivo.

Na próxima compra: "Entregar novamente em Rua X, 120?"

Opções: - Usar endereço - Alterar

9.  TAXA DE ENTREGA

A loja poderá configurar taxas por bairro.

Exemplo: Ponta Negra — R$ 5,00 Capim Macio — R$ 6,00 Neópolis — R$ 8,00
Nova Parnamirim — R$ 10,00

Ao selecionar o bairro, a taxa será calculada automaticamente.

10. PAGAMENTO

Formas iniciais:

PIX NA ENTREGA O pedido será identificado como "Pagamento: PIX na
entrega". Não será necessária integração bancária inicialmente.

DINHEIRO Pergunta: "Precisa de troco?"

Se sim: "Troco para quanto?"

Exemplo: Pedido: R$ 42,00 Troco para: R$ 100,00

11. REVISÃO DO PEDIDO

Antes de enviar, o cliente verá: - Produtos - Quantidades - Subtotal -
Taxa de entrega - Total - Forma de pagamento - Endereço

Botão: FAZER PEDIDO

12. NÚMERO DO PEDIDO

Após finalizar: "Pedido realizado!"

Exemplo: Pedido #A184

O cliente poderá acompanhar o pedido sem precisar criar uma conta
tradicional.

13. ACOMPANHAMENTO EM TEMPO REAL

Status:

PEDIDO RECEBIDO "Recebemos seu pedido."

PEDIDO ACEITO "A loja confirmou seu pedido."

PREPARANDO "Seu pedido está sendo preparado."

SAIU PARA ENTREGA "Seu pedido está a caminho."

ENTREGUE "Pedido entregue. Bom apetite!"

O Supabase Realtime poderá atualizar a tela automaticamente.

14. NOTIFICAÇÕES PUSH DO CLIENTE

Exemplos:

"Pedido aceito! Já começamos a preparar seu pedido #A184."

"Preparando! Seu pedido já está na cozinha."

"Seu pedido saiu para entrega! Prepare-se, ele está chegando."

15. NOTIFICAÇÃO PARA A LOJA

Quando entrar um pedido:

"NOVO PEDIDO Pedido #A184 R$ 61,00"

Ao tocar na notificação, o painel poderá abrir diretamente o pedido.

16. PAINEL DA LOJA

Tela inicial: - Nome do estabelecimento - Loja aberta/fechada - Pedidos
do dia - Vendas do dia - Pedidos preparando - Pedidos em entrega

17. PAINEL DE PEDIDOS

Organização estilo Kanban:

NOVOS PREPARANDO PRONTOS EM ENTREGA FINALIZADOS

Cada pedido terá: - Número - Horário - Cliente - Produtos - Valor -
Pagamento - Botão Ver Pedido

18. PEDIDO NOVO

Ao abrir: - Cliente - Telefone - Endereço - Produtos - Observações -
Pagamento - Troco - Total

Botões: ACEITAR PEDIDO RECUSAR

Motivos de recusa: - Item indisponível - Loja fechando - Endereço fora
da área - Outro motivo

19. PREPARAÇÃO

Depois de aceitar: INICIAR PREPARO

Ao tocar: - Status muda para Preparando - Cliente recebe
atualização/push

20. PEDIDO PRONTO

Botão: PEDIDO PRONTO

Para retirada: "Aguardando cliente."

Para entrega: SAIU PARA ENTREGA

21. ENTREGA

Quando o entregador sair: - Loja marca "Saiu para entrega" - Cliente
recebe push - Pedido muda para Em entrega

Depois: FINALIZAR PEDIDO

22. CONTROLE DE PRODUTOS

No painel: - Foto - Nome - Categoria - Preço - Status - Estoque opcional

Ações: - Adicionar - Editar - Ativar/desativar - Marcar esgotado

23. DISPONÍVEL HOJE

Cada produto poderá ter: "Disponível hoje"

Exemplo: Feijoada — Disponível Lasanha — Disponível Carne de sol —
Indisponível

O cliente verá apenas os itens definidos pela loja conforme as regras de
disponibilidade.

24. PRODUTO ESGOTADO

O produto poderá ser marcado como ESGOTADO sem ser excluído. Depois, o
dono poderá ativá-lo novamente.

25. CATEGORIAS

O proprietário poderá criar e ordenar categorias: - Pratos do dia -
Lanches - Combos - Bebidas - Sobremesas

26. ADICIONAIS

O dono poderá administrar adicionais por produto ou categoria.

Exemplo: Bacon + R$ 4 Queijo + R$ 3 Carne + R$ 8

27. HORÁRIO DA LOJA

Configuração por dia.

Exemplo: Segunda: 18h–23h Terça: 18h–23h Quarta: Fechado

Fora do horário: "Estamos fechados no momento."

28. ABRIR E FECHAR MANUALMENTE

O responsável poderá pausar pedidos mesmo durante o horário de
funcionamento.

Exemplo: "Pedidos pausados temporariamente."

29. TEMPO DE ENTREGA

Configuração: 30–45 minutos

Em horários movimentados: 50–70 minutos

O cliente verá a estimativa antes de comprar.

30. DASHBOARD

Indicadores: - Pedidos de hoje - Vendas - Ticket médio - Pedidos
cancelados - Pedidos preparando - Pedidos em entrega

31. PRODUTOS MAIS VENDIDOS

Ranking de produtos.

Exemplo: 1º X-Bacon — 32 2º Combo casal — 21 3º Pizza grande — 18

32. HISTÓRICO

Filtros: - Hoje - Ontem - 7 dias - 30 dias

Busca pelo número do pedido.

33. CLIENTES RECORRENTES

O sistema poderá identificar clientes pelo telefone e manter histórico
de pedidos conforme a arquitetura e regras de privacidade adotadas.

34. PWA

Cliente e painel da loja poderão funcionar como PWA.

O estabelecimento poderá adicionar o painel à tela inicial do celular e
utilizá-lo com aparência de aplicativo.

35. ARQUITETURA

Frontend inicial: - HTML - CSS - JavaScript

Backend: - Supabase

O projeto poderá migrar/evoluir para frameworks como React conforme
crescer.

36. RECURSOS DO SUPABASE

-   Database: produtos, clientes, pedidos etc.
-   Auth: autenticação dos administradores da loja
-   Realtime: atualização dos pedidos em tempo real
-   Storage: fotos dos produtos
-   Edge Functions: automações e integração com notificações push

37. ESTRUTURA INICIAL DO BANCO

Tabelas sugeridas: - estabelecimentos - usuarios - categorias -
produtos - adicionais - clientes - enderecos - pedidos - itens_pedido -
item_adicionais - taxas_entrega - configuracoes - notificacoes -
push_subscriptions

38. SEGURANÇA

Cliente poderá: - Criar pedidos - Consultar o próprio pedido

Cliente não poderá: - Alterar preços - Alterar produtos - Acessar
pedidos de outros clientes - Alterar pedidos já processados fora das
regras permitidas

A loja terá permissões administrativas protegidas por autenticação e
regras de acesso.

39. NAVEGAÇÃO NO CELULAR

Cliente: - Início - Pedidos - Perfil - Carrinho flutuante

Loja: - Início - Pedidos - Cardápio - Relatórios - Configurações

40. VISUAL

Interface mobile-first: - Fotos grandes - Cards arredondados - Pouco
texto - Botões grandes - Categorias horizontais - Carrinho
fixo/flutuante - Animações leves - Feedback ao adicionar produtos

41. FLUXO COMPLETO

Cliente acessa o link ↓ Escolhe produtos ↓ Carrinho ↓ Endereço ↓ Entrega
ou retirada ↓ PIX na entrega ou dinheiro ↓ Confirma pedido ↓ Loja recebe
notificação ↓ Loja aceita ↓ Cliente recebe atualização ↓ Preparando ↓
Cliente recebe atualização ↓ Saiu para entrega ↓ Cliente recebe push ↓
Entregue ↓ Pedido finalizado

42. ESCOPO RECOMENDADO PARA A V1

A primeira versão deverá priorizar:

-   Cardápio
-   Categorias
-   Produtos e fotos
-   Adicionais
-   Carrinho
-   Endereço
-   Entrega/retirada
-   Taxa por bairro
-   PIX na entrega
-   Dinheiro e troco
-   Criação do pedido
-   Painel da loja
-   Aceitar/recusar pedido
-   Preparando
-   Pronto
-   Saiu para entrega
-   Entregue
-   Acompanhamento em tempo real
-   Notificações push
-   Disponibilidade do dia
-   Controle de produtos
-   Horário da loja
-   PWA
-   Supabase

A arquitetura poderá ser preparada desde o início para futuramente
suportar múltiplos estabelecimentos, cada um com seu próprio cardápio,
configurações, produtos, pedidos e painel administrativo.

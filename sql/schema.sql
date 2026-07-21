-- Esquema do banco (Supabase/Postgres) — rastreamento de tráfego e
-- distribuição de grupos do WhatsApp da landing sorteios-peps.shop.
--
-- Tabelas:
--   grupos  — links dos grupos com regras (ativo, limite de cliques)
--   visitas — um registro por carregamento de página (PageView)
--   cliques — um registro por clique no botão, com o grupo entregue
--
-- Função registrar_clique() — escolhe o grupo (fiel ao anterior da pessoa;
-- senão, sorteio ponderado pela coluna "peso"), registra o clique e devolve
-- o link. Atômica: o contador é incrementado na mesma transação.

create table if not exists grupos (
  id bigint generated always as identity primary key,
  nome text not null,
  link text not null,
  ativo boolean not null default true,
  max_cliques integer,            -- null = sem limite
  peso numeric not null default 1,-- fatia do tráfego novo (ex.: 35 e 65)
  cliques_count integer not null default 0,
  criado_em timestamptz not null default now()
);
-- para bancos criados antes da coluna de peso existir
alter table grupos add column if not exists peso numeric not null default 1;

create table if not exists visitas (
  id bigint generated always as identity primary key,
  criado_em timestamptz not null default now(),
  external_id text,
  ip text,
  user_agent text,
  idioma text,
  fuso text,
  tela text,
  plataforma text,
  referrer text,
  url text,
  fbp text,
  fbc text,
  fbclid text,
  utm_source text,
  utm_medium text,
  utm_campaign text,
  utm_content text,
  utm_term text,
  versao text
);
create index if not exists visitas_external_id_idx on visitas (external_id);
create index if not exists visitas_criado_em_idx on visitas (criado_em);

create table if not exists cliques (
  id bigint generated always as identity primary key,
  criado_em timestamptz not null default now(),
  external_id text,
  grupo_id bigint references grupos (id),
  grupo_link text,
  ip text,
  user_agent text,
  url text,
  fbp text,
  fbc text,
  fbclid text,
  utm_source text,
  utm_medium text,
  utm_campaign text,
  utm_content text,
  utm_term text,
  versao text
);
create index if not exists cliques_external_id_idx on cliques (external_id);
create index if not exists cliques_grupo_id_idx on cliques (grupo_id);

-- Segurança: RLS ligado sem políticas — só a service_role (servidor) acessa.
alter table grupos enable row level security;
alter table visitas enable row level security;
alter table cliques enable row level security;

-- Só entra no rateio quem veio de anúncio. Considera válido um fbclid do
-- Facebook com formato plausível (descarta vazio, truncado ou digitado).
create or replace function fbclid_valido(v text) returns boolean
language sql immutable as $$
  select v is not null and length(v) >= 20 and v ~ '^[A-Za-z0-9_.-]+$';
$$;

-- índices para a busca de atribuição de anúncio nas visitas
create index if not exists visitas_fbp_idx on visitas (fbp);
create index if not exists visitas_ip_ua_idx on visitas (ip, user_agent);

create or replace function registrar_clique(
  p_external_id text default null,
  p_ip text default null,
  p_user_agent text default null,
  p_url text default null,
  p_fbp text default null,
  p_fbc text default null,
  p_fbclid text default null,
  p_utm_source text default null,
  p_utm_medium text default null,
  p_utm_campaign text default null,
  p_utm_content text default null,
  p_utm_term text default null,
  p_versao text default null
) returns table (grupo_id bigint, link text)
language plpgsql
security definer
set search_path = public
as $$
declare
  g grupos%rowtype;
  v_id bigint;
  v_total numeric;
  v_r numeric;
  v_fbclid text;
begin
  -- 1) FIDELIDADE ABSOLUTA: quem já recebeu um link recebe sempre o mesmo
  --    grupo (mesmo pausado ou cheio — a pessoa já tem o acesso de qualquer
  --    forma). Identificação em ordem de confiança: ext_id, cookie fbp,
  --    e por fim IP + navegador nos últimos 30 dias.
  if p_external_id is not null and p_external_id <> '' then
    select gr.* into g
    from cliques c
    join grupos gr on gr.id = c.grupo_id
    where c.external_id = p_external_id
    order by c.criado_em desc
    limit 1;
  end if;

  if g.id is null and p_fbp is not null and p_fbp <> '' then
    select gr.* into g
    from cliques c
    join grupos gr on gr.id = c.grupo_id
    where c.fbp = p_fbp
    order by c.criado_em desc
    limit 1;
  end if;

  if g.id is null and p_ip is not null and p_user_agent is not null then
    select gr.* into g
    from cliques c
    join grupos gr on gr.id = c.grupo_id
    where c.ip = p_ip
      and c.user_agent = p_user_agent
      and c.criado_em > now() - interval '30 days'
    order by c.criado_em desc
    limit 1;
  end if;

  -- 2) ATRIBUIÇÃO DE ANÚNCIO: descobre se a pessoa veio do Facebook.
  --    Usa o fbclid do próprio clique (vindo do cookie de anúncio) e, se
  --    faltar, procura nas visitas já registradas dela — os parâmetros são
  --    limpos da URL, então a origem fica guardada no servidor.
  if fbclid_valido(p_fbclid) then
    v_fbclid := p_fbclid;
  end if;

  if v_fbclid is null and p_external_id is not null and p_external_id <> '' then
    select v.fbclid into v_fbclid
    from visitas v
    where v.external_id = p_external_id
      and fbclid_valido(v.fbclid)
      and v.criado_em > now() - interval '30 days'
    order by v.criado_em desc
    limit 1;
  end if;

  if v_fbclid is null and p_fbp is not null and p_fbp <> '' then
    select v.fbclid into v_fbclid
    from visitas v
    where v.fbp = p_fbp
      and fbclid_valido(v.fbclid)
      and v.criado_em > now() - interval '30 days'
    order by v.criado_em desc
    limit 1;
  end if;

  if v_fbclid is null and p_ip is not null and p_user_agent is not null then
    select v.fbclid into v_fbclid
    from visitas v
    where v.ip = p_ip
      and v.user_agent = p_user_agent
      and fbclid_valido(v.fbclid)
      and v.criado_em > now() - interval '30 days'
    order by v.criado_em desc
    limit 1;
  end if;

  -- 3) Sem histórico de grupo:
  if g.id is null then
    if v_fbclid is null or p_external_id is null or p_external_id = '' then
      -- Não veio de anúncio (ou não há identificador para travar a pessoa
      -- depois): vai SEMPRE para o Grupo 1, sem sorteio.
      select gr.* into g from grupos gr where gr.id = 1;
    else
      -- Clique de anúncio: sorteio PONDERADO pela coluna "peso"
      -- (método da roleta). A chance de cada grupo é proporcional ao seu
      -- peso entre os ativos com vaga. Ex.: pesos 35 e 65 => 35% e 65%.
      select coalesce(sum(gr.peso), 0) into v_total
      from grupos gr
      where gr.ativo
        and (gr.max_cliques is null or gr.cliques_count < gr.max_cliques)
        and gr.peso > 0;

      if v_total > 0 then
        v_r := random() * v_total;   -- um único sorteio por clique
        select t.id into v_id
        from (
          select gr.id, sum(gr.peso) over (order by gr.id) as acum
          from grupos gr
          where gr.ativo
            and (gr.max_cliques is null or gr.cliques_count < gr.max_cliques)
            and gr.peso > 0
        ) t
        where t.acum >= v_r
        order by t.acum
        limit 1;

        select * into g from grupos where id = v_id;
      end if;
    end if;
  end if;

  -- 4) Nenhum grupo disponível: devolve vazio (o servidor usa o link reserva)
  if g.id is null then
    return;
  end if;

  update grupos set cliques_count = cliques_count + 1 where id = g.id;

  insert into cliques (
    external_id, grupo_id, grupo_link, ip, user_agent, url,
    fbp, fbc, fbclid, utm_source, utm_medium, utm_campaign, utm_content, utm_term, versao
  ) values (
    nullif(p_external_id, ''), g.id, g.link, p_ip, p_user_agent, p_url,
    p_fbp, p_fbc, coalesce(v_fbclid, p_fbclid), p_utm_source, p_utm_medium, p_utm_campaign, p_utm_content, p_utm_term, p_versao
  );

  return query select g.id, g.link;
end;
$$;

revoke execute on function registrar_clique from public, anon, authenticated;

-- Grupo inicial (link atual do botão)
insert into grupos (nome, link)
select 'Grupo 1', 'https://chat.whatsapp.com/JJl7p5jjARbKZ35wcjQKw6'
where not exists (select 1 from grupos);

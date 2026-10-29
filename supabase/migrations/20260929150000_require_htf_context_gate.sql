-- Make the supported automatic H4 + H1 context detector a hard gate for the
-- two new HTF strategies. Strategy ids and immutable historical snapshots are
-- intentionally preserved.
do $$
declare
  v_strategy record;
  v_personal_rules jsonb;
  v_metadata jsonb;
  v_selections jsonb;
  v_tree_children jsonb;
begin
  for v_strategy in
    select id, user_id
    from public.strategy_profiles
    where lower(name) in (
      lower('Forex HTF Liquidity & Structure v1'),
      lower('Gold HTF Liquidity Expansion v1')
    )
      and is_archived = false
  loop
    update public.strategy_profiles
    set require_trend_alignment = true,
        required_evidence = array[
          'h4TrendAligned',
          'h1TrendAligned',
          'liquiditySweep',
          'chochConfirmed',
          'bosConfirmed',
          'retestConfirmed'
        ]::text[],
        updated_at = now()
    where id = v_strategy.id
      and user_id = v_strategy.user_id;

    insert into public.strategy_rules (
      strategy_id,
      user_id,
      rule_key,
      label,
      enabled,
      mandatory,
      weight,
      minimum_confidence,
      timeframe_role,
      evaluation_mode,
      sort_order
    ) values (
      v_strategy.id,
      v_strategy.user_id,
      'trend-alignment',
      'Trend Alignment',
      true,
      true,
      10,
      72,
      'CONFIRMATION',
      'AUTOMATIC',
      0
    )
    on conflict (strategy_id, rule_key) do update
    set label = excluded.label,
        enabled = excluded.enabled,
        mandatory = excluded.mandatory,
        weight = excluded.weight,
        minimum_confidence = excluded.minimum_confidence,
        timeframe_role = excluded.timeframe_role,
        evaluation_mode = excluded.evaluation_mode,
        sort_order = excluded.sort_order;

    update public.strategy_rules
    set sort_order = case rule_key
      when 'trend-alignment' then 0
      when 'liquidity-sweep' then 1
      when 'displacement' then 2
      when 'choch' then 3
      when 'bos' then 4
      when 'retest' then 5
      when 'fair-value-gap' then 6
      when 'order-block' then 7
      when 'engulfing' then 8
      when 'premium-discount' then 9
      when 'session-open' then 10
      when 'pullback-entry' then 11
      when 'liquidity-run' then 12
      when 'volume-expansion' then 13
      else sort_order
    end
    where strategy_id = v_strategy.id;

    select personal_rules
      into v_personal_rules
    from public.strategy_profiles
    where id = v_strategy.id
      and user_id = v_strategy.user_id;

    select (item ->> 'value')::jsonb
      into v_metadata
    from jsonb_array_elements(coalesce(v_personal_rules, '[]'::jsonb)) item
    where item ->> 'key' = 'trade-police-v2-metadata'
    limit 1;

    if v_metadata is null then
      raise exception 'HTF strategy % is missing its V2 metadata.', v_strategy.id;
    end if;

    select jsonb_agg(
      case
        when selection ->> 'key' = 'trend-alignment' then
          jsonb_set(
            jsonb_set(
              jsonb_set(selection, '{requirement}', '"REQUIRED"'::jsonb),
              '{timeframe}',
              '"H1"'::jsonb
            ),
            '{group}',
            '"ALL"'::jsonb
          )
        else selection
      end
      order by ordinal
    )
      into v_selections
    from jsonb_array_elements(v_metadata -> 'ruleSelections')
      with ordinality selections(selection, ordinal);

    if not exists (
      select 1
      from jsonb_array_elements(v_selections) selection
      where selection ->> 'key' = 'trend-alignment'
    ) then
      raise exception 'HTF strategy % is missing the trend-alignment selection.', v_strategy.id;
    end if;

    select jsonb_build_array(
      jsonb_build_object(
        'type', 'CONDITION',
        'ruleKey', 'trend-alignment',
        'requirement', 'REQUIRED',
        'timeframe', 'H1'
      )
    ) || coalesce(jsonb_agg(
      case
        when child ->> 'type' = 'GROUP' then
          jsonb_set(
            child,
            '{children}',
            coalesce((
              select jsonb_agg(optional_child order by optional_ordinal)
              from jsonb_array_elements(child -> 'children')
                with ordinality optional_children(optional_child, optional_ordinal)
              where optional_child ->> 'ruleKey' <> 'trend-alignment'
            ), '[]'::jsonb)
          )
        else child
      end
      order by ordinal
    ) filter (where child ->> 'ruleKey' <> 'trend-alignment'), '[]'::jsonb)
      into v_tree_children
    from jsonb_array_elements(v_metadata #> '{ruleTree,children}')
      with ordinality children(child, ordinal);

    v_metadata := jsonb_set(v_metadata, '{ruleSelections}', v_selections);
    v_metadata := jsonb_set(v_metadata, '{ruleTree,children}', v_tree_children);

    update public.strategy_profiles profile
    set personal_rules = (
      select jsonb_agg(
        case
          when item ->> 'key' = 'trade-police-v2-metadata' then
            jsonb_set(item, '{value}', to_jsonb(v_metadata::text))
          else item
        end
        order by ordinal
      )
      from jsonb_array_elements(coalesce(profile.personal_rules, '[]'::jsonb))
        with ordinality rules(item, ordinal)
    )
    where profile.id = v_strategy.id
      and profile.user_id = v_strategy.user_id;
  end loop;
end $$;

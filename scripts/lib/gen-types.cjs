// Generates supabase-js compatible `Database` types from a migrated Postgres (PGlite).
// Replaces `supabase gen types`, which needs Docker or an access token (decision D16).

const SCALARS = {
  uuid: 'string', text: 'string', varchar: 'string', bpchar: 'string', citext: 'string',
  date: 'string', time: 'string', timetz: 'string', timestamp: 'string', timestamptz: 'string', interval: 'string',
  int2: 'number', int4: 'number', int8: 'number', float4: 'number', float8: 'number', numeric: 'number',
  bool: 'boolean', json: 'Json', jsonb: 'Json', tsvector: 'unknown', bytea: 'string', inet: 'unknown',
};

async function introspect(query) {
  const enums = await query(`
    select t.typname as name, array_agg(e.enumlabel order by e.enumsortorder) as labels
      from pg_type t join pg_enum e on e.enumtypid = t.oid join pg_namespace n on n.oid = t.typnamespace
     where n.nspname = 'public' group by t.typname order by t.typname`);
  const columns = await query(`
    select c.relname as rel, c.relkind as kind, a.attname as col, a.attnum as pos,
           not a.attnotnull as nullable, a.atthasdef as has_default, a.attidentity <> '' as is_identity,
           a.attgenerated <> '' as is_generated, t.typname as type, t.typcategory as category,
           et.typname as elem_type, tn.nspname as type_schema
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      join pg_attribute a on a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped
      join pg_type t on t.oid = a.atttypid
      join pg_namespace tn on tn.oid = t.typnamespace
      left join pg_type et on et.oid = t.typelem and t.typcategory = 'A'
     where n.nspname = 'public' and c.relkind in ('r', 'v')
     order by c.relname, a.attnum`);
  const fks = await query(`
    select con.conname as name, c.relname as rel, rc.relname as ref_rel,
           array(select a.attname from unnest(con.conkey) with ordinality k(n, i) join pg_attribute a on a.attrelid = con.conrelid and a.attnum = k.n order by k.i) as cols,
           array(select a.attname from unnest(con.confkey) with ordinality k(n, i) join pg_attribute a on a.attrelid = con.confrelid and a.attnum = k.n order by k.i) as ref_cols,
           exists (select 1 from pg_index i where i.indrelid = con.conrelid and i.indisunique and i.indkey::int2[] = con.conkey) as one_to_one,
           rn.nspname as ref_schema
      from pg_constraint con
      join pg_class c on c.oid = con.conrelid join pg_namespace n on n.oid = c.relnamespace
      join pg_class rc on rc.oid = con.confrelid join pg_namespace rn on rn.oid = rc.relnamespace
     where con.contype = 'f' and n.nspname = 'public'
     order by c.relname, con.conname`);
  const functions = await query(`
    select p.proname as name, coalesce(p.proargnames, '{}') as arg_names, p.proretset as returns_set, p.pronargdefaults as n_defaults,
           array(select t.typname from unnest(p.proargtypes) with ordinality a(oid, i) join pg_type t on t.oid = a.oid order by a.i) as arg_types,
           array(select tn.nspname from unnest(p.proargtypes) with ordinality a(oid, i) join pg_type t on t.oid = a.oid join pg_namespace tn on tn.oid = t.typnamespace order by a.i) as arg_schemas,
           rt.typname as return_type, rn.nspname as return_schema,
           -- RETURNS TABLE (...) output columns: names, types and schemas where the arg mode is 't'.
           coalesce(array(select p.proargnames[a.i] from unnest(coalesce(p.proallargtypes, '{}'::oid[])) with ordinality a(oid, i)
                           where p.proargmodes[a.i] = 't' order by a.i), '{}') as out_names,
           coalesce(array(select t.typname from unnest(coalesce(p.proallargtypes, '{}'::oid[])) with ordinality a(oid, i) join pg_type t on t.oid = a.oid
                           where p.proargmodes[a.i] = 't' order by a.i), '{}') as out_types,
           coalesce(array(select tn.nspname from unnest(coalesce(p.proallargtypes, '{}'::oid[])) with ordinality a(oid, i) join pg_type t on t.oid = a.oid
                           join pg_namespace tn on tn.oid = t.typnamespace where p.proargmodes[a.i] = 't' order by a.i), '{}') as out_schemas
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      join pg_type rt on rt.oid = p.prorettype join pg_namespace rn on rn.oid = rt.typnamespace
     where n.nspname = 'public' and p.prokind = 'f' order by p.proname`);
  return { enums, columns, fks, functions };
}

function tsType(c, enumNames) {
  const base = (name, schema) => {
    if (schema === 'public' && enumNames.has(name)) return `Database['public']['Enums']['${name}']`;
    return SCALARS[name] ?? 'unknown';
  };
  if (c.category === 'A') {
    const inner = base(c.elem_type, c.type_schema);
    return `${inner.includes(' ') || inner.includes('[') ? `(${inner})` : inner}[]`;
  }
  return base(c.type, c.type_schema);
}

function generate({ enums, columns, fks, functions }) {
  const enumNames = new Set(enums.map((e) => e.name));
  const rels = new Map();
  for (const c of columns) {
    if (!rels.has(c.rel)) rels.set(c.rel, { kind: c.kind, cols: [] });
    rels.get(c.rel).cols.push(c);
  }
  const relationships = (rel) =>
    fks
      .filter((f) => f.rel === rel && f.ref_schema === 'public')
      .map((f) => `          {\n            foreignKeyName: '${f.name}'\n            columns: [${f.cols.map((x) => `'${x}'`).join(', ')}]\n            isOneToOne: ${f.one_to_one}\n            referencedRelation: '${f.ref_rel}'\n            referencedColumns: [${f.ref_cols.map((x) => `'${x}'`).join(', ')}]\n          },`)
      .join('\n');

  const block = (kind) =>
    [...rels.entries()]
      .filter(([, r]) => r.kind === kind)
      .map(([name, r]) => {
        const row = r.cols.map((c) => `          ${c.col}: ${tsType(c, enumNames)}${c.nullable || kind === 'v' ? ' | null' : ''}`).join('\n');
        const rel = relationships(name);
        const relText = rel ? `[\n${rel}\n        ]` : '[]';
        if (kind === 'v') return `      ${name}: {\n        Row: {\n${row}\n        }\n        Relationships: ${relText}\n      }`;
        const ins = r.cols
          .map((c) => {
            if (c.is_generated) return `          ${c.col}?: never`;
            const optional = c.nullable || c.has_default || c.is_identity;
            return `          ${c.col}${optional ? '?' : ''}: ${tsType(c, enumNames)}${c.nullable ? ' | null' : ''}`;
          })
          .join('\n');
        const upd = r.cols
          .map((c) => (c.is_generated ? `          ${c.col}?: never` : `          ${c.col}?: ${tsType(c, enumNames)}${c.nullable ? ' | null' : ''}`))
          .join('\n');
        return `      ${name}: {\n        Row: {\n${row}\n        }\n        Insert: {\n${ins}\n        }\n        Update: {\n${upd}\n        }\n        Relationships: ${relText}\n      }`;
      })
      .join('\n');

  const enumBlock = enums.map((e) => `      ${e.name}: ${e.labels.map((l) => `'${l}'`).join(' | ')}`).join('\n');
  const typeOfName = (typname, schema) => {
    const isArray = typname.startsWith('_');
    const ts = tsType({ category: 'X', type: isArray ? typname.slice(1) : typname, type_schema: schema }, enumNames);
    return isArray ? `${ts.includes(' ') ? `(${ts})` : ts}[]` : ts;
  };
  const fnBlock = functions.length
    ? functions
        .map((f) => {
          const args = f.arg_types.length
            ? `{ ${f.arg_types.map((t, i) => `${f.arg_names[i]}${i >= f.arg_types.length - f.n_defaults ? '?' : ''}: ${typeOfName(t, f.arg_schemas[i])}${i >= f.arg_types.length - f.n_defaults ? ' | null' : ''}`).join('; ')} }`
            : 'Record<PropertyKey, never>';
          const ret =
            f.return_type === 'void'
              ? 'undefined'
              : f.out_names.length
                ? `{ ${f.out_names.map((nm, i) => `${nm}: ${typeOfName(f.out_types[i], f.out_schemas[i])} | null`).join('; ')} }`
                : typeOfName(f.return_type, f.return_schema);
          return `      ${f.name}: {\n        Args: ${args}\n        Returns: ${f.returns_set ? `${ret}[]` : ret}\n      }`;
        })
        .join('\n')
    : '      [_ in never]: never';

  return `// GENERATED by scripts/gen-db-types.mjs from supabase/migrations. Do not edit by hand.
// Regenerate with: npm run db:types   (a db test fails if this file is stale)

export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type Database = {
  public: {
    Tables: {
${block('r')}
    }
    Views: {
${block('v')}
    }
    Functions: {
${fnBlock}
    }
    Enums: {
${enumBlock}
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
};

type PublicSchema = Database['public'];
export type Tables<T extends keyof PublicSchema['Tables']> = PublicSchema['Tables'][T]['Row'];
export type TablesInsert<T extends keyof PublicSchema['Tables']> = PublicSchema['Tables'][T]['Insert'];
export type TablesUpdate<T extends keyof PublicSchema['Tables']> = PublicSchema['Tables'][T]['Update'];
export type Views<T extends keyof PublicSchema['Views']> = PublicSchema['Views'][T]['Row'];
export type Enums<T extends keyof PublicSchema['Enums']> = PublicSchema['Enums'][T];
`;
}

/** @param {(sql: string) => Promise<any[]>} query */
async function generateDatabaseTypes(query) {
  return generate(await introspect(query));
}

module.exports = { generateDatabaseTypes };

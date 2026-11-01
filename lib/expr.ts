/**
 * Tiny, sandboxed arithmetic expression evaluator for slider simulations.
 *
 * Agent 3 writes formulas like "min(1, cacheSize / workingSet)" instead of JS,
 * so a bad generation can never execute code in the learner's browser.
 * Supports: numbers, identifiers, + - * / % ^, comparisons, && || !, ?:,
 * and a whitelist of Math functions. Shared by server (validation) and client.
 */

type Node =
  | { k: "num"; v: number }
  | { k: "id"; name: string }
  | { k: "un"; op: string; a: Node }
  | { k: "bin"; op: string; a: Node; b: Node }
  | { k: "tern"; c: Node; a: Node; b: Node }
  | { k: "call"; fn: string; args: Node[] };

const FUNCS: Record<string, (...a: number[]) => number> = {
  min: Math.min,
  max: Math.max,
  abs: Math.abs,
  sqrt: Math.sqrt,
  log: Math.log,
  log2: Math.log2,
  log10: Math.log10,
  exp: Math.exp,
  floor: Math.floor,
  ceil: Math.ceil,
  round: Math.round,
  pow: Math.pow,
  clamp: (x, lo, hi) => Math.min(hi, Math.max(lo, x)),
};
const CONSTS: Record<string, number> = { pi: Math.PI, e: Math.E };

const TOKEN = /\s*(\d+\.?\d*(?:e[+-]?\d+)?|\.\d+|[A-Za-z_][A-Za-z0-9_]*|&&|\|\||<=|>=|==|!=|[-+*/%^()<>!?:,])/y;

function tokenize(src: string): string[] {
  const out: string[] = [];
  TOKEN.lastIndex = 0;
  let pos = 0;
  while (pos < src.length) {
    if (/^\s*$/.test(src.slice(pos))) break;
    TOKEN.lastIndex = pos;
    const m = TOKEN.exec(src);
    if (!m) throw new Error(`Unexpected character at ${pos}: "${src.slice(pos, pos + 8)}"`);
    out.push(m[1]);
    pos = TOKEN.lastIndex;
  }
  return out;
}

const PREC: Record<string, number> = {
  "||": 1, "&&": 2, "==": 3, "!=": 3, "<": 4, ">": 4, "<=": 4, ">=": 4,
  "+": 5, "-": 5, "*": 6, "/": 6, "%": 6, "^": 7,
};

export function parse(src: string): Node {
  if (src.length > 300) throw new Error("Expression too long");
  const t = tokenize(src);
  let i = 0;
  const peek = () => t[i];
  const eat = (s?: string) => {
    const tok = t[i++];
    if (s && tok !== s) throw new Error(`Expected "${s}" but found "${tok ?? "end"}"`);
    return tok;
  };

  function primary(): Node {
    const tok = eat();
    if (tok === undefined) throw new Error("Unexpected end of expression");
    if (tok === "(") {
      const n = ternary();
      eat(")");
      return n;
    }
    if (tok === "-" || tok === "!" || tok === "+") return { k: "un", op: tok, a: binary(7) };
    if (/^[\d.]/.test(tok)) return { k: "num", v: Number(tok) };
    if (/^[A-Za-z_]/.test(tok)) {
      if (peek() === "(") {
        if (!Object.hasOwn(FUNCS, tok)) throw new Error(`Unknown function "${tok}"`);
        eat("(");
        const args: Node[] = [];
        if (peek() !== ")") {
          args.push(ternary());
          while (peek() === ",") {
            eat(",");
            args.push(ternary());
          }
        }
        eat(")");
        return { k: "call", fn: tok, args };
      }
      return { k: "id", name: tok };
    }
    throw new Error(`Unexpected token "${tok}"`);
  }

  function binary(minPrec: number): Node {
    let left = primary();
    for (;;) {
      const op = peek();
      const p = op !== undefined ? PREC[op] : undefined;
      if (p === undefined || p < minPrec) return left;
      eat();
      // ^ is right-associative
      const right = binary(op === "^" ? p : p + 1);
      left = { k: "bin", op, a: left, b: right };
    }
  }

  function ternary(): Node {
    const c = binary(1);
    if (peek() === "?") {
      eat("?");
      const a = ternary();
      eat(":");
      const b = ternary();
      return { k: "tern", c, a, b };
    }
    return c;
  }

  const n = ternary();
  if (i < t.length) throw new Error(`Unexpected token "${t[i]}"`);
  return n;
}

function run(n: Node, env: Record<string, number>): number {
  switch (n.k) {
    case "num":
      return n.v;
    case "id":
      // Own properties only: "constructor", "toString"... must not resolve through the prototype.
      if (Object.hasOwn(env, n.name)) return env[n.name];
      if (Object.hasOwn(CONSTS, n.name)) return CONSTS[n.name];
      throw new Error(`Unknown variable "${n.name}"`);
    case "un": {
      const a = run(n.a, env);
      return n.op === "-" ? -a : n.op === "!" ? Number(!a) : a;
    }
    case "tern":
      return run(n.c, env) ? run(n.a, env) : run(n.b, env);
    case "call":
      return FUNCS[n.fn](...n.args.map((x) => run(x, env)));
    case "bin": {
      const a = run(n.a, env);
      const b = run(n.b, env);
      switch (n.op) {
        case "+": return a + b;
        case "-": return a - b;
        case "*": return a * b;
        case "/": return a / b;
        case "%": return a % b;
        case "^": return Math.pow(a, b);
        case "<": return Number(a < b);
        case ">": return Number(a > b);
        case "<=": return Number(a <= b);
        case ">=": return Number(a >= b);
        case "==": return Number(a === b);
        case "!=": return Number(a !== b);
        case "&&": return Number(Boolean(a) && Boolean(b));
        case "||": return Number(Boolean(a) || Boolean(b));
      }
    }
  }
  throw new Error("Bad expression node");
}

/** Parsed-expression cache, bounded: the server sees new model-written formulas forever. */
const cache = new Map<string, Node>();
const CACHE_MAX = 500;

export function evaluate(src: string, env: Record<string, number>): number {
  let ast = cache.get(src);
  if (!ast) {
    ast = parse(src);
    if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value as string);
    cache.set(src, ast);
  }
  return run(ast, env);
}

/** Returns an error message, or null when the expression is safe and finite for env. */
export function checkExpr(src: string, env: Record<string, number>): string | null {
  try {
    const v = evaluate(src, env);
    if (!Number.isFinite(v)) return `"${src}" is not finite at default values`;
    return null;
  } catch (e) {
    return `"${src}": ${(e as Error).message}`;
  }
}

/**
 * `fengari` ships no bundled declarations and there is no `@types/fengari` on
 * npm, so `strict: true` raises TS7016 on any import of it.
 *
 * The surface is declared member-by-member rather than as a blanket
 * `declare module 'fengari'`, because a blanket declaration types every export
 * as `any` — including ones that do not exist. The point of the one consumer
 * (`src/lib/rateLimit/__tests__/slidingWindowScript.lua.test.ts`) is to run the
 * shipped Lua through a real VM, and a typo'd `lua_*` symbol silently becoming
 * `undefined` at runtime would undermine that. Listing them means the compiler
 * catches the typo instead.
 *
 * Only what that test uses is declared. Add members here as needed; do not
 * widen to a blanket module declaration.
 */
declare module 'fengari' {
  /** Opaque `lua_State` handle. Only ever passed back into the API. */
  export type LuaState = unknown;

  /** Encodes a JS string to the byte array every fengari string API expects. */
  export function to_luastring(s: string): Uint8Array;

  export const lua: {
    readonly LUA_OK: number;
    readonly LUA_TNIL: number;
    readonly LUA_TNUMBER: number;
    readonly LUA_TTABLE: number;
    lua_createtable(L: LuaState, narr: number, nrec: number): void;
    lua_geti(L: LuaState, index: number, n: number): number;
    lua_gettop(L: LuaState): number;
    lua_newtable(L: LuaState): void;
    lua_pop(L: LuaState, n: number): void;
    lua_pushcfunction(L: LuaState, fn: (L: LuaState) => number): void;
    lua_pushinteger(L: LuaState, n: number): void;
    lua_pushstring(L: LuaState, s: Uint8Array): void;
    lua_seti(L: LuaState, index: number, n: number): void;
    lua_setfield(L: LuaState, index: number, k: Uint8Array): void;
    lua_setglobal(L: LuaState, name: Uint8Array): void;
    lua_tointeger(L: LuaState, index: number): number;
    lua_tojsstring(L: LuaState, index: number): string;
    lua_tonumber(L: LuaState, index: number): number;
    lua_type(L: LuaState, index: number): number;
  };

  export const lauxlib: {
    luaL_newstate(): LuaState;
    luaL_dostring(L: LuaState, s: Uint8Array): number;
  };

  export const lualib: {
    luaL_openlibs(L: LuaState): void;
  };
}

export * from "./block";
export * from "./channels";
// Um `export` por ARQUIVO, nunca pela pasta.
//
// O gateway roda TypeScript direto com `tsx` em ESM, e o Node ESM NAO resolve
// import de diretorio (`ERR_UNSUPPORTED_DIR_IMPORT`) — nem com um `index.ts`
// dentro. O Next resolve, entao `export * from "./conexoes"` passava no
// typecheck e no build e derrubava o gateway em producao.
export * from "./conexoes/armazenamento";
export * from "./conexoes/registro";
export * from "./conexoes/state";
export * from "./conexoes/tipos";
export * from "./dm";
export * from "./equipe";
export * from "./flags";
export * from "./friends";
export * from "./member";
export * from "./plan";
export * from "./session";
export * from "./spotify";
export * from "./spotify-account";
export * from "./tickets";
export * from "./tokens";

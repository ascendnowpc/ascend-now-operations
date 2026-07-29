// Students, teachers and admins all use a mnemonic text id whose trailing
// number is the original sequence value (e.g. BATO26-1, RANW26-3). Sorting on
// that number keeps "order by id" meaning creation order — plain string
// sorting would order by the name prefix instead, which is just a name sort.
export function idSeqNumber(id: string): number {
  return parseInt(/(\d+)$/.exec(id)?.[1] ?? "", 10) || 0;
}

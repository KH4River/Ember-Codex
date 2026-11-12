/** A pack file the user chose, already read as text. */
export interface OpenedPack {
  name: string;
  contents: string;
}

/** The one file seam the pack service sees. Desktop and mobile implement it
 *  differently; nothing above this names a platform. */
export interface PackFilesPort {
  openPack(): Promise<OpenedPack | null>;
  savePack(contents: string, suggestedName: string): Promise<boolean>;
}

/** A pack file the user chose, already read as text. */
export interface OpenedPack {
  name: string;
  contents: string;
}

/** The file seam. Desktop answers it from the main process, mobile from the
 *  Capacitor picker. Neither side names a path. */
export interface PackFilesApi {
  openPack(): Promise<OpenedPack | null>;
  savePack(contents: string, suggestedName: string): Promise<boolean>;
}

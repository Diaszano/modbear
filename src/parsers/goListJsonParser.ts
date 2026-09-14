export interface GoListModule {
  readonly Path: string;
  readonly Version?: string;
  readonly Main?: boolean;
  readonly Indirect?: boolean;
  readonly Dir?: string;
  readonly GoMod?: string;
  readonly GoVersion?: string;
  readonly Update?: { readonly Path: string; readonly Version?: string };
  readonly Replace?: GoListModule;
  readonly Retracted?: readonly string[];
  readonly Deprecated?: string;
  readonly Error?: { readonly Err: string };
}

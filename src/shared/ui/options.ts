/** Choice lists the segmented control, select and tabs render. */
export interface SegmentOption {
  value: string;
  label: string;
  /** Versions are set in Geist Mono; words like "Semua" are not. */
  mono?: boolean;
}

export interface SelectOption {
  value: string;
  label: string;
}

export interface TabOption {
  value: string;
  label: string;
  count?: number;
}

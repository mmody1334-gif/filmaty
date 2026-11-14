export type MediaKind = "movie" | "series";

export interface Candidate {
  id: string;
  title: string;
  year?: number;
  kind: MediaKind;
  site: string;
  siteLabel: string;
  url: string;
  poster?: string;
  similarity?: number;
}

export interface Episode {
  season: number;
  episode: number;
  title: string;
  url: string;
}

export interface SeasonGroup {
  season: number;
  episodes: Episode[];
}

export interface SourceLink {
  name: string;
  url: string;
  quality: string;
  kind: "mp4" | "hls" | "embed";
  referer?: string;
  downloadUrl?: string;
  fileSize?: string;
}

export interface MediaDetails {
  candidate: Candidate;
  title: string;
  description?: string;
  poster?: string;
  year?: number;
  kind: MediaKind;
  seasons: SeasonGroup[];
  sources: SourceLink[];
}

export interface Provider {
  id: string;
  label: string;
  kinds: MediaKind[];
  search(query: string, kind?: MediaKind): Promise<Candidate[]>;
  getDetails(candidate: Candidate): Promise<MediaDetails>;
  getEpisodeSources(episode: Episode): Promise<SourceLink[]>;
}

export type MediaKind = "movie" | "series";

export interface Candidate {
  id: string;
  title: string;
  year?: number;
  rating?: string;
  kind: MediaKind;
  site: string;
  siteLabel: string;
  url: string;
  poster?: string;
  similarity?: number;
}

export interface Episode {
  id?: string;
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
  directVideoUrl?: string;
  fileSize?: string;
  streamId?: string;
}

export interface MediaDetails {
  candidate: Candidate;
  title: string;
  description?: string;
  poster?: string;
  year?: number;
  rating?: string;
  kind: MediaKind;
  seasons: SeasonGroup[];
  sources: SourceLink[];
}

export interface ResolvedStream {
  directVideoUrl: string;
  quality: string;
  size?: string;
  fileName?: string;
}

export interface Provider {
  id: string;
  label: string;
  kinds: MediaKind[];
  search(query: string, kind?: MediaKind): Promise<Candidate[]>;
  getDetails(candidate: Candidate): Promise<MediaDetails>;
  getEpisodeSources(episode: Episode): Promise<SourceLink[]>;
  resolveStream?(watchUrl: string): Promise<ResolvedStream>;
  // All direct variants on a watch page (e.g. Akwam lists 480p/720p/1080p
  // files). Optional: providers without it resolve a single stream via
  // resolveStream. Best quality first, deduplicated by quality.
  resolveStreams?(watchUrl: string): Promise<ResolvedStream[]>;
}

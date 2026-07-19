const PLATFORM_LABELS: Record<string, string> = {
  spotify: 'Spotify',
  appleMusic: 'Apple Music',
  amazonMusic: 'Amazon Music',
  bandcamp: 'Bandcamp',
  instagram: 'Instagram',
  youtube: 'YouTube',
  tiktok: 'TikTok',
  x: 'X',
  facebook: 'Facebook',
  website: 'Website',
  dragcity: 'Drag City',
  soundcloud: 'SoundCloud',
}

export function platformLabel(platform: string): string {
  return PLATFORM_LABELS[platform] ?? platform
}

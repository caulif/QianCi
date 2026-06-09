export interface DictionaryAttribution {
  label: string;
  url: string;
  serviceLabel?: string;
  serviceUrl?: string;
  translationServiceLabel?: string;
  translationServiceUrl?: string;
}

export interface DictionaryEntry {
  word: string;
  phonetic: string;
  translation: string;
  rank: number;
  source?: 'bundled' | 'custom' | 'online';
  attribution?: DictionaryAttribution;
}

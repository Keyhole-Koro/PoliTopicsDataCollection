export interface RawMeetingData {
  numberOfRecords: number;
  numberOfReturn: number;
  startRecord: number;
  nextRecordPosition: number;
  meetingRecords: RawMeetingRecord[];
}

export interface RawMeetingRecord {
  issueID: string;
  imageKind: string;
  searchObject: number;
  session: number;
  nameOfHouse: string;
  nameOfMeeting: string;
  issue: string;
  date: string;
  closing: string | null;
  speechRecord: RawSpeechRecord[];
}


export interface RawSpeechRecord {
  speechID: string;
  speechOrder: number;
  speaker: string;
  speakerYomi: string | null;
  speakerGroup: string | null;
  speakerPosition: string | null;
  speakerRole: string | null;
  speech: string;
  startPage: number;
  createTime: string;
  updateTime: string;
  speechURL: string;
}

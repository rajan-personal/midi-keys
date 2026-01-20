declare module 'react-piano' {
  import * as React from 'react';

  export interface NoteRange {
    first: number;
    last: number;
  }

  export interface PianoProps {
    noteRange: NoteRange;
    activeNotes?: number[];
    playNote?: (midiNumber: number) => void;
    stopNote?: (midiNumber: number) => void;
    onPlayNoteInput?: (midiNumber: number) => void;
    onStopNoteInput?: (midiNumber: number) => void;
    renderNoteLabel?: (params: { keyboardShortcut: any; midiNumber: number; isActive: boolean; isAccidental: boolean }) => React.ReactNode;
    className?: string;
    disabled?: boolean;
    width?: number;
    keyboardShortcuts?: any[];
  }

  export class Piano extends React.Component<PianoProps> {}

  export const MidiNumbers: {
    fromNote: (note: string) => number;
  };
}

import { useCallback, type ChangeEvent } from 'react'
import { useNavigate } from 'react-router-dom'

type LibraryProps = {
  selectedFile: File | null
  onSelectFile: (file: File) => void
}

function Library({ selectedFile, onSelectFile }: LibraryProps) {
  const navigate = useNavigate()

  const handleFileChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0]
      if (!file) return
      onSelectFile(file)
      navigate('/player')
    },
    [navigate, onSelectFile]
  )

  return (
    <div className="app">
      <header className="hero">
        <div>
          <p className="eyebrow">MIDI Piano Player</p>
          <h1>Select a MIDI song to begin.</h1>
          <p className="subtitle">
            Pick a .mid or .midi file and jump straight into the playback view.
          </p>
        </div>
        <div className="controls">
          <label className="file-input pulse">
            <input type="file" accept=".mid,.midi" onChange={handleFileChange} />
            <span>{selectedFile?.name ?? 'Choose MIDI file'}</span>
          </label>
          <button
            className="primary"
            onClick={() => navigate('/player')}
            disabled={!selectedFile}
          >
            Go to Player
          </button>
        </div>
      </header>

      <section className="tutorial">
        <div className="tutorial-step">
          <span className="step-number">1</span>
          <div>
            <h3>Pick a song</h3>
            <p>Upload a MIDI file from your computer.</p>
          </div>
        </div>
        <div className="tutorial-step">
          <span className="step-number">2</span>
          <div>
            <h3>Jump into the player</h3>
            <p>Open the player view to hear and see the notes.</p>
          </div>
        </div>
        <div className="tutorial-step">
          <span className="step-number">3</span>
          <div>
            <h3>Learn with visuals</h3>
            <p>Follow falling notes and key highlights as you listen.</p>
          </div>
        </div>
      </section>
    </div>
  )
}

export default Library

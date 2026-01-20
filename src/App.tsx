import { useState } from 'react'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'

import Library from './pages/Library'
import Player from './pages/Player'
import './App.css'

function App() {
  const [selectedFile, setSelectedFile] = useState<File | null>(null)

  return (
    <BrowserRouter>
      <Routes>
        <Route
          path="/"
          element={<Library selectedFile={selectedFile} onSelectFile={setSelectedFile} />}
        />
        <Route
          path="/player"
          element={<Player file={selectedFile} onSelectFile={setSelectedFile} />}
        />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  )
}

export default App

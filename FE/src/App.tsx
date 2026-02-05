import { useState } from 'react';
import { ChatWidget } from './components/ChatWidget';
import { Button } from './components/ui/button';

const iconPng = "/assets/icon.png"

function App() {
  const [isChatOpen, setIsChatOpen] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);

  return (
    <div className="min-h-screen bg-white">
      {/* Floating Chat Widget */}
      {isChatOpen ? (
        <div className="fixed inset-0 z-50 flex items-stretch justify-center sm:inset-auto sm:bottom-6 sm:right-6 sm:block">
          <ChatWidget
            isOpen={isChatOpen}
            isExpanded={isExpanded}
            onClose={() => setIsChatOpen(false)}
            onToggleExpand={() => setIsExpanded(!isExpanded)}
          />
        </div>
      ) : (
        <div className="fixed bottom-0 right-0 z-50 p-4 sm:bottom-6 sm:right-6 sm:p-0">
          <Button
            onClick={() => setIsChatOpen(true)}
            className="h-12 w-12 sm:h-14 sm:w-14 rounded-full shadow-lg"
            style={{ backgroundColor: '#0000F0' }}
            size="icon"
          >
            <img src={iconPng} alt="Burokratt" className="h-6 w-6" />
          </Button>
        </div>
      )}
    </div>
  );
}

export default App

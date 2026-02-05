import { useState } from 'react';
import { ChatWidget } from './components/ChatWidget';
import { MessageCircle } from 'lucide-react';
import { Button } from './components/ui/button';

function App() {
  const [isChatOpen, setIsChatOpen] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);

  return (
    <div className="min-h-screen bg-white">
      {/* Floating Chat Widget */}
      <div className="fixed bottom-6 right-6 z-50">
        {isChatOpen ? (
          <ChatWidget 
            isOpen={isChatOpen}
            isExpanded={isExpanded}
            onClose={() => setIsChatOpen(false)}
            onToggleExpand={() => setIsExpanded(!isExpanded)}
          />
        ) : (
          <Button
            onClick={() => setIsChatOpen(true)}
            className="h-14 w-14 rounded-full shadow-lg"
            style={{ backgroundColor: '#0000F0' }}
            size="icon"
          >
            <MessageCircle className="h-6 w-6 text-white" />
          </Button>
        )}
      </div>
    </div>
  );
}

export default App

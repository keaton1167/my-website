import React, {useEffect} from 'react';

export default function Root({children}) {
  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    if (!window.chatbase || window.chatbase('getState') !== 'initialized') {
      const chatbaseStub = (...args) => {
        if (!chatbaseStub.q) {
          chatbaseStub.q = [];
        }
        chatbaseStub.q.push(args);
      };

      window.chatbase = new Proxy(chatbaseStub, {
        get(target, prop) {
          if (prop === 'q') {
            return target.q;
          }
          return (...args) => target(prop, ...args);
        },
      });
    }

    const loadChatbase = () => {
      if (document.getElementById('Q3q1cv4db4-tr-gTSMCpY')) {
        return;
      }

      const script = document.createElement('script');
      script.src = 'https://www.chatbase.co/embed.min.js';
      script.id = 'Q3q1cv4db4-tr-gTSMCpY';
      script.setAttribute('domain', 'www.chatbase.co');
      document.body.appendChild(script);
    };

    if (document.readyState === 'complete') {
      loadChatbase();
    } else {
      window.addEventListener('load', loadChatbase);
    }

    return () => {
      window.removeEventListener('load', loadChatbase);
    };
  }, []);

  return <>{children}</>;
}
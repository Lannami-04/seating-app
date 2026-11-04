import { useState } from 'react' //bring tools
import Chair from './Chair'

function App() { //define 
  const [count, setCount] = useState(0) //memory (state)


  return ( //what is showed in the screen
    <>
      <button onClick={() => setCount((count) => count + 1)}>
        Count is {count}
      </button> 

      <button onClick={() => setCount(0)}>
        Reset
      </button>
      <Chair color ="pink" /> 
      <Chair color ="pink" /> 
      <Chair color ="yellow" /> 
      <Chair color ="yellow" /> 
    </>
  )
}

export default App //make it reusable elsewhere
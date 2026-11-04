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
      <Chair color ="pink" seatNumber={1} /> 
      <Chair color ="pink" seatNumber={2}/> 
      <Chair color ="yellow" seatNumber={3} /> 
      <Chair color ="yellow" seatNumber={4} /> 
    </>
  )
}

export default App //make it reusable elsewhere
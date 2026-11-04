import { useState } from 'react' //bring tools
import Chair from './Chair'

function App() { //define component
  const [count, setCount] = useState(0) //memory (state)

  return ( //what is showed in the screen
    <>
      <button onClick={() => setCount((count) => count + 1)}>
        Count is {count}
      </button> 

      <button onClick={() => setCount(0)}>
        Reset
      </button>
      <Chair /> 
      <Chair /> 
      <Chair /> 
      <Chair /> 
    </>
  )
}

export default App //make it reusable elsewhere
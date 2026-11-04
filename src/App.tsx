import { useState } from 'react' //bring tools
import Chair from './Chair'

const chairs = [
  { seatNumber: 1, color: 'pink' },
  { seatNumber: 2, color: 'pink' },
  { seatNumber: 3, color: 'yellow' },
  { seatNumber: 4, color: 'yellow' },
  { seatNumber: 5, color: 'yellow' },
  { seatNumber: 6, color: 'pink' },
]

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
      {chairs.map((chair) => (
        <Chair key={chair.seatNumber} color={chair.color} seatNumber={chair.seatNumber} />
      ))}

    </>
  )
}

export default App //make it reusable elsewhere
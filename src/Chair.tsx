import { useState } from 'react'

function Chair( {color}: { color: string}) { //define component
    const [isTaken, setIsTaken] = useState(false)

    return ( //what is showed in screen
        <button
            onClick={() => setIsTaken((isTaken) => !isTaken)}
            style={{
                width: 48,
                height: 48,
                borderRadius: '50%',
                backgroundColor: isTaken ? color : 'gray',
            }}
        />
    )
}

export default Chair

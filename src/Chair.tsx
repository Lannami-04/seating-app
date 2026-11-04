import { useState } from 'react'

function Chair() { //define component
    const [isTaken, setIsTaken] = useState(false)

    return ( //what is showed in screen
        <>
            <button
                onClick={() => setIsTaken((isTaken) => !isTaken)}
                style={{
                    width: 48,
                    height: 48,
                    borderRadius: '50%',
                    backgroundColor: isTaken ? 'pink' : 'gray',
                }}
            />
        </>
    )
}

export default Chair

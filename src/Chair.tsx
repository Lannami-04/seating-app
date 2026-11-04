import { useState } from 'react'

interface ChairProps { //give props' shape a name
    color: string
    seatNumber: number
}

function Chair({ color, seatNumber }: ChairProps) { //define component
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
        >
            {seatNumber}
        </button>
    )


}

export default Chair

import './frosty-loader.scss';

export default function FrostyLoader({ message }: { message: string }) {
    return (
        <div className='frosty-loader'>
            <div className='frosty-loader__card'>
                <img src='/frostydbot-logo.jpeg' alt='FrostyDBot' className='frosty-loader__logo' />
                <div className='frosty-loader__name'>
                    {'FROSTYDBOT'.split('').map((char, i) => (
                        <span
                            key={i}
                            className='frosty-loader__name__char'
                            style={{ animationDelay: `${i * 0.08}s` }}
                        >
                            {char}
                        </span>
                    ))}
                </div>
                <div className='frosty-loader__bar-wrap'>
                    <div className='frosty-loader__bar' />
                </div>
                <p className='frosty-loader__message'>{message || 'Initializing FrostyDBot…'}</p>
            </div>
        </div>
    );
}

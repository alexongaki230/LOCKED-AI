import React from 'react';
import classNames from 'classnames';
import Text from '@/components/shared_ui/text';
import { LabelPairedChevronDownCaptionBoldIcon, LabelPairedChevronUpCaptionBoldIcon } from '@deriv/quill-icons/LabelPaired';

type TAccordionContent = {
    header: string;
    content: React.ReactNode;
};

type TQuickStrategyAccordionProps = {
    content_data: TAccordionContent;
    expanded?: boolean;
    is_cursive?: boolean;
    no_collapsible?: boolean;
    has_subtitle?: boolean;
    expanded_subtitles_storage: { [key: string]: boolean };
    setExpandedSubtitlesStorage: (value: { [key: string]: boolean }) => void;
    font_size?: string;
};

const QuickStrategyAccordion = ({
    content_data,
    expanded = false,
    no_collapsible = false,
    has_subtitle = true,
    expanded_subtitles_storage,
    setExpandedSubtitlesStorage,
    font_size = 'xs',
}: TQuickStrategyAccordionProps) => {
    const storage_key = `${content_data.header}`.split(' ').join('_').toLowerCase();
    const stored_value = expanded_subtitles_storage[storage_key];
    const is_open = stored_value !== undefined ? stored_value : expanded;

    const toggle = () => {
        if (no_collapsible) return;
        setExpandedSubtitlesStorage({
            ...expanded_subtitles_storage,
            [storage_key]: !is_open,
        });
    };

    if (!has_subtitle) {
        return <div className='qs-accordion__content'>{content_data.content}</div>;
    }

    return (
        <div className={classNames('qs-accordion', { 'qs-accordion--open': is_open })}>
            <div
                className={classNames('qs-accordion__header', {
                    'qs-accordion__header--no-collapsible': no_collapsible,
                })}
                onClick={toggle}
            >
                <Text size={font_size as 'xs'} weight='bold'>
                    {content_data.header}
                </Text>
                {!no_collapsible && (
                    <span className='qs-accordion__icon'>
                        {is_open ? (
                            <LabelPairedChevronUpCaptionBoldIcon fill='var(--text-general)' />
                        ) : (
                            <LabelPairedChevronDownCaptionBoldIcon fill='var(--text-general)' />
                        )}
                    </span>
                )}
            </div>
            {(is_open || no_collapsible) && (
                <div className='qs-accordion__content'>{content_data.content}</div>
            )}
        </div>
    );
};

export default QuickStrategyAccordion;
